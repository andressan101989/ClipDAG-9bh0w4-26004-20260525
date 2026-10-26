# F5 final-review fix wave

Scope: exactly the two Important findings from whole-branch review, based on
`24548b61a03d851d329c43935ec845aa1b398a65`, integration base
`8b869746ea4bbc08fb79d42fe06f316849a7bfb9`. Worktree:
`D:\CodexWorktrees\ClipDAG\f5-autonomous-subscriptions`.

## Corrections

1. F5 creates `get_my_creator_premium_subscriptions_v3`; it no longer changes
   either installed v1 or v2 endpoint. The shipped exact v2 parser retains its
   original shape; the separate exact v3 parser requires the F5 `auto_renewal`
   object. Declarations, service dispatch, UI fixtures, plan and design use v3.
   No endpoint negotiation or permissive parsing was added.
2. The wrapper-journal cancellation replay adds `already_cancelled=true` only
   to an ordinary `status=cancelled` receipt without `cancellation_effect`.
   The race acknowledgement keeps `already_cancelled=false`. Replay still
   returns before mandate mutation, including replay after fresh consent;
   the pre-F5 canonical replay early return is unchanged.

Real SQL regressions compare v1/v2 response bytes before/after F5, parse v2 with
the exact F4 module loaded from frozen commit `8b869746`, parse v3 through the
current client, reject crossed shapes, and pass both ordinary/race cancellation
replay receipts through the real parser. Ordinary replay also proves unchanged
newer mandate and monetary state. The exact changed function catalog is checked
against the policy using PostgreSQL-derived definitions, owners and ACLs.

## RED evidence and intermediate observations

Before production edits:

```text
node --test --test-name-pattern="F5 preserves the shipped" tests/creatorPremiumF5ClientContracts.test.mjs
tests 1; pass 0; fail 1
creator_premium_subscriptions_invalid (v2 rejects the shipped original shape)
duration_ms 1750
```

With `RUN_CREATOR_PREMIUM_F5_LOCAL=1` and
`CREATOR_PREMIUM_PG_WSL_PID=2112462`:

```text
node --test tests/creatorPremiumF5Local.integration.mjs
tests 22; pass 19; fail 3; skipped 0
duration_ms 116059.3881
ordinary wrapper cancellation replay: creator_premium_cancellation_receipt_invalid
```

The three failures comprise the ordinary replay regression, an initial legacy
projection test assumption, and the parent test aggregate. The legacy assumption
was corrected: v1 intentionally returns the pre-existing F3 upgrade-required
blocker, which the F4 v1 parser rejects. The final test preserves v1 bytes and
checks the installed F4 v2 parser separately; no production parser was weakened.
An intermediate post-fix SQL run was 20 PASS / 2 FAIL for only that v1 assumption
and parent aggregate, then the corrected run passed 22/22 in 114894.8033 ms.

The first sandboxed SQL attempt could not access WSL (`Wsl/E_ACCESSDENIED`);
the authorized escalated local command succeeded. No hosted fallback occurred.
An intermediate ESLint run caught missing explicit `node:buffer` import in the
new test; the import was added and the rerun passed. Intermediate F3 UI fixtures
without the required F5 field failed; UI fixtures now explicitly use v3 while
the F3 compatibility fixture remains v2. No test was dropped or skipped to hide
these failures.

## Exact governance changes

The manifest remains exactly one migration plus existing `bdag-ledger`, HIGH.
Cron identity, schedule, database, username, active flag and command are unchanged.
No Edge implementation or configuration changed in this wave.

- Migration Git blob: `ca08f3a5224cea2ef6b4390bc625d55f378b2ca6`.
- Migration LF SHA-256: `5975e535f4818981e076f4f8617caa8e357852a4926a3f1c8c5e8879712299f3`.
- Cancel authority hash: `4e65a126f42f161d7df22d75c06f040e0c56f34951e2132937aaf202e6e35fa4`.
- v3 authority hash: `f330b19ccbea0b419c451cf944feafcd040a27197e0b61fb639f2cdd267d154f`.
- v3 definition hash: `246ab182de52bedd431e12a54ddf48923ecbd85e296ad6e138e54017f5ed7489`.
- v3 Advisor fingerprint: `e14d79e47e9db72a50028805bf1a1f321e5c7df19dd2d23b6128e78d1bfa4a16`.
- F5 transition digest: `d0007b7995d96246a51136948e44a97221fb0fc42845824bbea186ad695c9829`.
- Finance authority digest: `ea2c6ef88c685b684defae6233fa773c2a2b6dd8b4a488d768a4d193f6d8e934`.
- Finance Advisor digest: `e2d18b540ee595bbad3dd64e04a6ad42a09aba71a80fe3dc92d4a8097e97cfbe`.

The v2 catalog entry is inherited unchanged; v3 is an explicit addition. The
snapshot adapter preserves the v2 exception before and after F5 and introduces
only v3 afterward. The obsolete F5 v2 predecessor replacement was removed.
Client attestation now also pins the `.d.mts` declarations and service RPC call,
alongside the parser and unchanged ledger client. All exact hash checks,
ancestry, productive closure and mutation rejection remain enabled.

The existing reviewed-source anchor remains the original feature source; the
protected post-merge attestation update remains a separate controller-owned
step. The Git regression tests actual committed HEAD and verifies its exact
new blobs; no test transport substitutes working-tree bytes for committed bytes.

## Verification

Final F5 real PostgreSQL and structural command:

```text
RUN_CREATOR_PREMIUM_F5_LOCAL=1 CREATOR_PREMIUM_PG_WSL_PID=2112462
node --test tests/creatorPremiumF5AutonomousSubscriptions.test.mjs tests/creatorPremiumF5Local.integration.mjs
tests 25; pass 25; fail 0; skipped 0; duration_ms 199526.7927
```

PostgreSQL 17.6 in the verified local namespace; template
`algo6_final_compile_a2`; real pg_cron in disposable `contrib_regression`.
The harness drops its database in `finally`. New function catalog evidence is
computed from Git LF migration bytes to avoid Windows checkout CRLF drift.

Focused client/finance/structural command:

```text
node --test tests/creatorPremiumB4ClientFinance.test.mjs tests/creatorPremiumF2FinanceContracts.test.mjs tests/creatorPremiumF2CompleteMonetization.test.mjs tests/creatorPremiumF3CanaryContracts.test.mjs tests/creatorPremiumF3C2Governance.test.mjs tests/creatorPremiumF3FinalWalletIntegration.test.mjs tests/creatorPremiumF4GeneralActivation.test.mjs tests/creatorPremiumF5AutonomousSubscriptions.test.mjs tests/creatorPremiumF5ClientContracts.test.mjs
tests 116; pass 116; fail 0; skipped 0; duration_ms 6859.2615
```

The known `MODULE_TYPELESS_PACKAGE_JSON` warning for
`creatorPremiumIntegrationState.ts` remains. Expected negative-path Edge
fixtures log sanitized rejection codes; they are passing assertions.

Focal TypeScript:

```text
npx.cmd tsc -p .tmp-f5-final-tsconfig.json --pretty false
exit 0; empty output
```

The temporary config covered the service, declarations, ledger client,
integration state, subscriptions screen and offer screen plus their imports.
It was removed after verification. This does not claim a clean global baseline.

Focal ESLint:

```text
npx.cmd eslint services/creatorPremiumService.ts services/creatorPremiumFinanceContracts.mjs services/creatorPremiumFinanceContracts.d.mts tests/creatorPremiumF5Local.integration.mjs tests/creatorPremiumF5ClientContracts.test.mjs tests/creatorPremiumF2FinanceContracts.test.mjs tests/creatorPremiumF3CanaryContracts.test.mjs scripts/nelyon-production-release.mjs scripts/nelyon-production-snapshot-adapter.mjs tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs
exit 0; 0 errors; 7 warnings
```

Warnings: six existing unused `policy` variables in gate tests and one no-matching
ESLint configuration warning for `.d.mts` (checked by TypeScript).

Pre-commit full governance command: 183 tests, 179 PASS, 1 FAIL, 3 existing
environment-gated PostgreSQL SKIP, duration 96130.2184 ms. The one failure was the
expected exact-HEAD migration blob check before the fix was committed.

Final full governance, against committed fix `63444ad8502104b08be0de327402c96d6cecefde`:

```text
node --test tests/nelyonProductionReleaseGate.test.mjs tests/nelyonProductionSnapshotAdapter.test.mjs
tests 183; pass 180; fail 0; skipped 3; duration_ms 91544.9922
```

All 126 release-gate tests passed, including real committed-blob/ancestry/client
mutation checks and the exact one-migration plus `bdag-ledger` HIGH manifest.
Snapshot adapter: 54 PASS; three existing environment-gated SQL skips:

- F3 disposable catalog verifies exact authority and detects real PostgreSQL security drift.
- F3 fact envelopes execute as the Management API read-only role before and after migration.
- F4 read-only facts execute against refunded commerce and reject hostile provenance/reconciliation drift.

The F5 changed catalog was separately exercised by the real PostgreSQL F5 suite.

Final relevant baseline real PostgreSQL regressions:

```text
CREATOR_PREMIUM_PG_WSL_PID=2112462
RUN_CREATOR_PREMIUM_F2_LOCAL=1 RUN_CREATOR_PREMIUM_F3_LOCAL=1
RUN_CREATOR_PREMIUM_F3_C2_LOCAL=1 RUN_CREATOR_PREMIUM_F4_LOCAL=1
node --test tests/creatorPremiumF2Local.integration.mjs tests/creatorPremiumF3Local.integration.mjs tests/creatorPremiumF3C2Local.integration.mjs tests/creatorPremiumF4Local.integration.mjs
tests 89; pass 89; fail 0; skipped 0; duration_ms 566409.4798
```

No timeout occurred. Combined with F5, this wave ran 114 real PostgreSQL/structural
checks successfully. `git diff --check`, `git diff --cached --check`, and
`git show --check HEAD` passed. The report-only final amendment changes none of
the tested source, test, migration, policy, compiler or snapshot bytes.

## Committed file set

- `.github/nelyon-production-release-policy.json`
- `.superpowers/sdd/2026-10-26-creator-premium-f5/final-fix-report.md`
- `docs/superpowers/plans/2026-10-26-creator-premium-f5.md`
- `docs/superpowers/specs/2026-10-26-creator-premium-f5-design.md`
- `scripts/nelyon-production-release.mjs`
- `scripts/nelyon-production-snapshot-adapter.mjs`
- `services/creatorPremiumFinanceContracts.d.mts`
- `services/creatorPremiumFinanceContracts.mjs`
- `services/creatorPremiumService.ts`
- `supabase/migrations/20261026072512_creator_premium_f5_autonomous_subscriptions.sql`
- `tests/creatorPremiumF2FinanceContracts.test.mjs`
- `tests/creatorPremiumF3CanaryContracts.test.mjs`
- `tests/creatorPremiumF5ClientContracts.test.mjs`
- `tests/creatorPremiumF5Local.integration.mjs`
- `tests/nelyonProductionReleaseGate.test.mjs`
- `tests/nelyonProductionSnapshotAdapter.test.mjs`

## Scope and limits

No hosted query or mutation, production BDAG movement, deployment, release,
GitHub mutation, or remote push occurred. All monetary activity used disposable
synthetic PostgreSQL fixtures. No physical-device QA is claimed. The repo has no
top-level `npm test` script; the explicit requested suites are the verification
entry points for this wave.

Automatic approval review rejected an initial broad whole-file compiler patch
because it obscured a security-critical gate change. The patch was replaced by
narrow explicit v3/catalog hunks, which were accepted; no workaround bypassed
the rejection and no permission blocker remains.
