# MKT-B7R Execution and Financial Audit Log

Execution dates: 2026-08-10 to 2026-08-11  
Branch: `codex/mkt-a4b-premium-integration`  
Starting local and origin HEAD: `4fae2a0fc95cb05e0f7d6aa5604ea442ed39f1ec`  
Build: 22

This record contains no credentials, access tokens, production row values, PII, or database connection strings. Exact command outputs are recorded only when they are aggregate or schema metadata.

## Startup and preservation

- The intentional initial worktree was `M package.json`, `?? scripts/prove-marketplace-settlement-reversal.mjs`, and `?? supabase/migrations/20260810180000_marketplace_post_settlement_reversal_authority.sql`.
- `git diff --check` passed before edits.
- The three draft files and the tracked binary patch were copied to a timestamped directory under the operating-system temporary directory before edits. The backup is outside the repository and is not committed.
- No unrelated user changes were present.

## Blocker 1 — completed settlement rejected by buyer dispute creation

1. Sequential blocker number: 1
2. Stage/command: initial draft proof; `report_marketplace_order_problem(...)` after delivery settlement
3. Exact SQLSTATE/error/message: SQLSTATE `22023`, `marketplace_dispute_settlement_completed`
4. Observable symptom: the draft could not create a buyer dispute after funds had been released.
5. Root cause: the buyer entry RPC intentionally rejects every order that already has a settlement. This is a buyer-protection state-machine boundary, not an authorization defect in that RPC.
6. Classification: current state-machine limitation
7. Solution chosen: preserve the buyer RPC unchanged and add `open_marketplace_post_settlement_review(...)`, a separate service-role/admin authority that derives all identities from the released order and moves no money.
8. Why safer: it does not broaden buyer authority or weaken the settlement-completed protection; post-settlement review is explicitly privileged and audited.
9. Files/functions changed: B7R migration; `open_marketplace_post_settlement_review`; `marketplace_post_settlement_review_receipt`.
10. Tests proving resolution: disposable admin-entry, non-admin denial, idempotency, no-money-movement, and buyer-report regression scenarios.
11. Production economics changed: no; review opening performs no ledger or financial-transaction writes.
12. Residual risk: operational policy must ensure only authorized administrators are designated in `user_profiles.is_admin`.
13. Final status: RESOLVED

## Blocker 2 — immutable payment/allocation refund guards

1. Sequential blocker number: 2
2. Stage/command: draft reversal state transition
3. Exact SQLSTATE/error/message: SQLSTATE `42501`, `marketplace_payment_snapshot_immutable`
4. Observable symptom: a released allocation could not transition to refunded, even with the existing dispute-refund session context.
5. Root cause: `marketplace_payment_refund_guard` supports `paid → refunded`, while `marketplace_allocation_release_guard` supported `held → refunded` and `held → released` but not `released → refunded`.
6. Classification: production authority defect
7. Solution chosen: preserve the existing trigger and all deployed guard branches, then extend the existing guard body with one narrow `released → refunded` branch under the canonical transaction-local `app.marketplace_dispute_refund='on'` context. All immutable allocation fields must remain identical, `released_at` must remain unchanged/non-null, and only `status` plus `refunded_at` may transition.
8. Why safer: this keeps the existing guard, authorization flag, snapshot comparisons, and trigger in force; it neither disables nor bypasses protection and permits only the missing terminal refund transition.
9. Files/functions changed: B7R migration; `marketplace_allocation_release_guard` extension performed in place from the deployed body.
10. Tests proving resolution: completed reversal transition plus unauthorized direct payment/allocation mutation rejection.
11. Production economics changed: yes, narrowly: a fully released allocation can now become fully refunded only inside the existing authorized dispute-refund context after economic reversal.
12. Residual risk: future edits to the deployed guard must retain the marked B7R branch; migration asserts the branch was installed.
13. Final status: RESOLVED

## Blocker 3 — draft lacked strict settlement-leg basis validation

1. Sequential blocker number: 3
2. Stage/command: production source audit of draft `reverse_marketplace_released_settlement`
3. Exact SQLSTATE/error/message: no runtime SQLSTATE; missing validation allowed unsafe execution paths. The replacement raises SQLSTATE `23514`, `marketplace_reversal_settlement_basis_invalid`.
4. Observable symptom: the draft accepted arbitrary positive legs, did not validate original transaction status/amount/currency/destination, defaulted unknown types to creator commission, and did not prove gross equality across authoritative rows.
5. Root cause: the draft treated settlement-leg iteration as sufficient evidence without validating the immutable economic basis.
6. Classification: migration defect
7. Solution chosen: validate settlement/payment/allocation/order identity and gross equality, allowed leg types, completed status, positive eligible legs, exact leg totals and split totals, and each original completed financial transaction before any financial write.
8. Why safer: reversal is derived only from immutable completed legs and fails atomically on any mismatch; escrow balance cannot mask a corrupt basis.
9. Files/functions changed: B7R migration; `reverse_marketplace_released_settlement`.
10. Tests proving resolution: organic, creator, multi-creator, same-creator-multiple-leg, and reconciliation scenarios.
11. Production economics changed: no forward formula changes; reversal mirrors historical amounts one-for-one.
12. Residual risk: unsupported historical `influencer_commission` legs deliberately require manual data review rather than implicit mapping.
13. Final status: RESOLVED

## Blocker 4 — draft did not lock all accounts as one deterministic set

1. Sequential blocker number: 4
2. Stage/command: concurrency/deadlock review of draft reversal function
3. Exact SQLSTATE/error/message: no observed SQLSTATE; unsafe lock sequencing was found by source inspection.
4. Observable symptom: beneficiary accounts were locked separately from escrow and buyer accounts, leaving inconsistent ordering and same-account aggregate preflight risk.
5. Root cause: locks were acquired during multiple phases and balance checks relied on leg iteration.
6. Classification: concurrency issue
7. Solution chosen: construct the union of every positive-leg beneficiary destination, Marketplace escrow, and buyer account; lock that entire set once in UUID order; then group legs by beneficiary account and compare balance to the aggregate required debit.
8. Why safer: every caller follows one lock order and repeated legs for the same beneficiary are preflighted as a single required debit.
9. Files/functions changed: B7R migration; `reverse_marketplace_released_settlement`.
10. Tests proving resolution: same-creator multiple legs and two-independent-connection race.
11. Production economics changed: no.
12. Residual risk: PostgreSQL advisory and row locks are transaction scoped; callers must not wrap the RPC in unrelated long-running work.
13. Final status: RESOLVED

## Blocker 5 — draft reconciliation contained hardcoded counters

1. Sequential blocker number: 5
2. Stage/command: production source audit of `reconcile_marketplace_settlement_reversals()`
3. Exact SQLSTATE/error/message: no SQLSTATE; draft contained `'duplicate_original_leg',0` and incomplete aliases.
4. Observable symptom: reconciliation could report healthy state without querying actual duplicate/mismatch conditions.
5. Root cause: the draft reconciliation was a placeholder.
6. Classification: reconciliation issue
7. Solution chosen: replace every requested counter with an independent aggregate query covering parentage, leg snapshots, original and reversal transactions, refund transaction, financial states, decision linkage, totals, and duplicates.
8. Why safer: every healthy zero is data-derived and independently auditable.
9. Files/functions changed: B7R migration; `reconcile_marketplace_settlement_reversals`.
10. Tests proving resolution: healthy disposable reconciliation plus negative source review; remote aggregate output recorded before and after deployment.
11. Production economics changed: no; read-only authority.
12. Residual risk: reconciliation detects persisted inconsistencies but does not auto-repair them.
13. Final status: RESOLVED

## Blocker 6 — duplicate transaction wrapper warnings

1. Sequential blocker number: 6
2. Stage/command: transactional DBBOOT apply of draft migration
3. Exact SQLSTATE/error/message: PostgreSQL warnings `there is already a transaction in progress` / `there is no transaction in progress` from nested top-level `BEGIN`/`COMMIT` handling.
4. Observable symptom: apply emitted transaction-boundary warnings and risked obscuring the actual apply boundary.
5. Root cause: the migration included top-level `BEGIN; COMMIT;` even though DBBOOT applies each migration transactionally.
6. Classification: disposable runtime mismatch
7. Solution chosen: remove both top-level statements; retain only function-local PL/pgSQL blocks.
8. Why safer: DBBOOT and Supabase own the single atomic migration transaction.
9. Files/functions changed: B7R migration.
10. Tests proving resolution: disposable apply must complete without transaction warnings; linked dry-run must list only B7R.
11. Production economics changed: no.
12. Residual risk: none identified.
13. Final status: RESOLVED

## Exact deployed resolver and grants audit

- Before B7R, `resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)` was `SECURITY DEFINER`, had `search_path=public`, and was executable only by its owner and `service_role`.
- Its held refund uses frozen allocation values, the canonical `app.marketplace_dispute_refund` context, one escrow-to-buyer transaction, one immutable final decision, and canonical receipt.
- Its `release_seller` route delegates to `release_marketplace_order_after_dispute_resolution`, which returns an existing settlement without issuing a second payout.
- B7R retains that exact deployed function under the internal name `resolve_marketplace_dispute_held_v1` and removes direct service-role execution from the helper. The original public signature becomes the sole service-role wrapper.

## Blocker 7 — completed retry bypassed reversal idempotency conflict

1. Sequential blocker number: 7
2. Stage/command: disposable scenario I, changed reason with the same completed reversal key
3. Exact SQLSTATE/error/message: observed SQLSTATE `23505`, `marketplace_dispute_conflicting_decision`; required deterministic message was `marketplace_reversal_idempotency_conflict`.
4. Observable symptom: same-key/same-request retry returned the original receipt, but same-key/changed-reason retry was evaluated by the held resolver after allocation status became `refunded`.
5. Root cause: wrapper routing tested only `allocation.status='released'`; a completed reversal necessarily transitions it to `refunded`.
6. Classification: migration defect
7. Solution chosen: route a full-refund request through reversal authority when either the allocation remains released or an immutable reversal already exists for the dispute.
8. Why safer: completed operations are always checked against their stored reversal fingerprint and cannot fall through to a different state machine.
9. Files/functions changed: B7R migration; canonical `resolve_marketplace_dispute` wrapper.
10. Tests proving resolution: same key/same request returned identical reversal and refund transaction with unchanged counts; changed reason/same key raised SQLSTATE `23505`, `marketplace_reversal_idempotency_conflict`.
11. Production economics changed: no.
12. Residual risk: none identified.
13. Final status: RESOLVED

## Blocker 8 — committed concurrency fixture left append-only event rows

1. Sequential blocker number: 8
2. Stage/command: disposable scenario J post-race table-count equality
3. Exact SQLSTATE/error/message: harness assertion `concurrency_cleanup_count_mismatch:public.marketplace_commerce_events,public.marketplace_inventory_movements,public.marketplace_inventory_reservation_events`.
4. Observable symptom: economic cleanup and shared balances were correct, but three correlated append-only event tables retained synthetic rows.
5. Root cause: the initial explicit cleanup list covered financial/order/settlement rows but omitted event rows created by reservation, inventory, and commerce triggers.
6. Classification: fixture defect
7. Solution chosen: add disposable-only correlated deletion by fixture order/product/variant/actor/checkout while referential triggers are disabled solely for cleanup; keep exact before/after counts for every `public` and `auth` table.
8. Why safer: cleanup is scoped to generated fixture identities on the verified localhost disposable database, and the all-table equality assertion proves no persistent row remains.
9. Files/functions changed: `scripts/prove-marketplace-settlement-reversal.mjs`.
10. Tests proving resolution: two independent clients produced one reversal/four legs/one refund, cleanup restored shared balances, and every `public`/`auth` table count exactly matched its pre-fixture baseline.
11. Production economics changed: no; proof code refuses any non-localhost/non-55422 database.
12. Residual risk: none outside the disposable proof environment.
13. Final status: RESOLVED

## Blocker 9 - transient linked proof bootstrap failure

1. Sequential blocker number: 9
2. Stage/command: first `npm.cmd run prove:marketplace-dispute-refund`
3. Exact SQLSTATE/error/message: harness error `dispute_refund_secure_connection_failed`; no database SQLSTATE was emitted because connection configuration bootstrap failed first.
4. Observable symptom: the held-refund regression exited before connecting.
5. Root cause: a transient linked Supabase CLI login bootstrap failure; the immediately repeated direct linked dry-run returned a valid configuration.
6. Classification: security/privilege issue
7. Solution chosen: verify the linked bootstrap independently, then rerun the unchanged held-refund proof.
8. Why safer: no credentials were logged or persisted and no proof assertion was weakened.
9. Files/functions changed: none.
10. Tests proving resolution: the complete held-refund suite passed on retry, including exact gross, review, release, security, race, rollback, and zero reconciliation assertions.
11. Production economics changed: no.
12. Residual risk: transient CLI bootstrap failures remain retryable operational noise.
13. Final status: RESOLVED

## Blocker 10 - parallel linked CLI temporary-login race

1. Sequential blocker number: 10
2. Stage/command: parallel shipping, promotions, and Ads finance regressions
3. Exact SQLSTATE/error/message: SQLSTATE `28P01`, reported as `MARKETPLACE_SHIPPING_PROOF_FAILED:connect:postgres_28P01`.
4. Observable symptom: promotions and Ads finance passed, while shipping failed authentication before fixture execution.
5. Root cause: parallel linked CLI bootstraps rotate the same temporary login role and invalidated one concurrently captured password.
6. Classification: concurrency issue
7. Solution chosen: run all remaining linked proof scripts sequentially.
8. Why safer: it removes credential-rotation races without persisting credentials or changing database tests.
9. Files/functions changed: none.
10. Tests proving resolution: the unchanged shipping proof passed sequentially with complete LIVE attribution, rollback, inventory restoration, and zero payment/settlement/commission reconciliations.
11. Production economics changed: no.
12. Residual risk: linked proofs should continue to avoid parallel CLI bootstraps.
13. Final status: RESOLVED

## Blocker 11 - Ads proof asserted an obsolete inline implementation location

1. Sequential blocker number: 11
2. Stage/command: `npm.cmd run prove:marketplace-ads`
3. Exact SQLSTATE/error/message: Node `AssertionError [ERR_ASSERTION]`; regex `/index\s*%\s*8\s*===\s*0/` did not match `app/(tabs)/shop.tsx`.
4. Observable symptom: the proof stopped during static source inspection before its rollback-only database fixtures.
5. Root cause: sponsored mixing had been extracted to `services/marketplaceSponsoredMix.ts`, but the older proof still required the expression inline in `shop.tsx`.
6. Classification: fixture defect
7. Solution chosen: verify that `shop.tsx` calls `mixMarketplaceSponsoredProducts(products, sponsored)`, and verify the 1-per-8 boundary plus organic-product deduplication in the extracted production helper.
8. Why safer: the proof follows the real module boundary and still asserts exact production behavior; no Ads runtime or economic formula changed.
9. Files/functions changed: `scripts/prove-marketplace-ads.mjs` only.
10. Tests proving resolution: the complete Ads delivery/events/attribution proof passed with every delivery and event reconciliation counter zero and persistent fixtures zero.
11. Production economics changed: no.
12. Residual risk: none identified.
13. Final status: RESOLVED

## Blocker 12 - nested remote audit CLI blocked from user telemetry/cache paths

1. Sequential blocker number: 12
2. Stage/command: `npm.cmd run audit:marketplace-b7r-remote` / direct Node runner
3. Exact SQLSTATE/error/message: operating-system `EACCES` on registry access with an empty npm cache, followed by `EPERM: operation not permitted` opening the user-level Supabase telemetry temporary file.
4. Observable symptom: the audit runner could not obtain short-lived linked connection settings when it spawned the CLI from inside the managed process sandbox.
5. Root cause: the approved top-level CLI has access to required user configuration paths, while a nested child process does not.
6. Classification: security/privilege issue
7. Solution chosen: retain the normal self-bootstrap path for ordinary environments, add a standard PostgreSQL environment-input path, and in this managed run invoke one approved direct CLI bootstrap whose values are passed only in process memory to the audit runner.
8. Why safer: credentials are neither printed by the audit command nor stored in repository files; reconciliation remains fail-closed.
9. Files/functions changed: `scripts/audit-marketplace-b7r-remote.mjs`; package audit command.
10. Tests proving resolution: pre-deploy audit connected, discovered every current Marketplace reconciliation, asserted all health counters, verified latest migration `20260810170000`, zero B7R fixture users, and no failure hook.
11. Production economics changed: no; read-only audit.
12. Residual risk: managed environments may need the direct CLI bootstrap wrapper; ordinary environments can use the package command directly.
13. Final status: RESOLVED

## Gate results

This section is updated as commands complete.

| Gate                               | Result                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Disposable destroy/create/verify   | PASS — baseline schema rebuilt and verified                                        |
| B7R migration apply                | PASS — clean DBBOOT apply; no transaction-boundary warnings                        |
| B7R proof scenarios A–N            | PASS — all scenarios executed; 32 reversal counters zero; persistent fixtures zero |
| Production-source safety audit     | PASS - no instrumentation tokens, hardcoded healthy counters, or top-level wrapper |
| Full regressions                   | PASS - all applicable Marketplace proofs and 597 Node tests passed                 |
| Focused ESLint                     | PASS - zero diagnostics in all modified JS/MJS files                               |
| TypeScript                         | BASELINE NONZERO - unrelated existing diagnostics; zero modified-file diagnostics |
| iOS export                         | PASS - 3,387 modules bundled; existing package export-map warnings only            |
| Remote pre-deploy reconciliations  | PASS - latest 20260810170000; all health counters zero; no B7R fixtures/hooks      |
| Linked dry-run                     | PASS - only `20260810180000_marketplace_post_settlement_reversal_authority.sql`    |
| Deployment and parity              | PASS - deployed latest migration exactly `20260810180000`                          |
| Remote post-deploy reconciliations | PASS - all legacy counters and all 32 B7R reversal counters zero                   |

## Residual risks

## Remote pre-deploy reconciliation output

The read-only remote audit discovered these exact functions and returned healthy results:

- `reconcile_marketplace_ad_delivery`: all 5 counters `0`.
- `reconcile_marketplace_ad_eligibility_clock`: all 4 counters `0`.
- `reconcile_marketplace_ad_events`: all 7 counters `0`.
- `reconcile_marketplace_ad_finalization`: all 4 counters `0`.
- `reconcile_marketplace_ad_finance`: all 24 counters `0`.
- `reconcile_marketplace_live_commissions`: all 9 counters `0`.
- `reconcile_marketplace_payments`: every health counter `0`, `invalid_confirmed_state_details=[]`; informational breakdown `confirmed=2`, `processing=0`, `shipped=2`, `delivered=21`, `refunded_fixture=233`, `invalid=0`.
- `reconcile_marketplace_settlements`: every integrity counter `0`; `escrow_expected_held_total=71.00000000`, `escrow_actual_balance=71.00000000`, difference/shortage/surplus all `0`.
- Latest remote migration: `20260810170000`.
- B7R disposable fixture users remotely: `0`.
- B7R failure function remotely: absent.
- B7R failure trigger remotely: absent.

## TypeScript baseline diagnostics

`npx.cmd tsc --noEmit --pretty false` remains nonzero because of existing diagnostics across unrelated app, background, component, hook, module, and service files. None of the modified B7R `.mjs`, SQL, JSON, or Markdown files appears in the diagnostics. Focused ESLint for every modified JavaScript file is clean, Node syntax checks pass, 597 tests pass, and the iOS export succeeds.

## Disposable cleanup

- The final formatted B7R proof rerun passed every scenario and all 32 reversal counters.
- `npm.cmd run db:marketplace-disposable -- destroy` returned `destroyed=true`.
- `docker ps --filter name=clipdag-marketplace-disposable` returned no container name.

## Commits, dry-run, deployment, and post-deploy verification

- Commit 1: `1472d95` - `feat: add marketplace post-settlement reversal authority`.
- Commit 2: `d0a335d` - `test: prove and document marketplace settlement reversals`.
- Linked dry-run output: `migrations=[20260810180000_marketplace_post_settlement_reversal_authority.sql]`, `seeds=[]`, `roles=[]`.
- Deployment output: the same one migration applied; no seeds or roles.
- Remote latest migration after deploy: `20260810180000`.
- `reconcile_marketplace_settlement_reversals`: all 32 required counters `0`.
- Every pre-existing Marketplace reconciliation retained the same healthy result recorded above, including payment, settlement, LIVE commission, Ads finance, Ads finalization, Ads eligibility, Ads delivery, and Ads events.
- Post-deploy held escrow remained exact: expected `71.00000000`, actual `71.00000000`, difference/shortage/surplus `0`.
- Post-deploy B7R fixture users: `0`.
- Post-deploy disposable failure function: absent.
- Post-deploy disposable failure trigger: absent.

## Final residual risk assessment

- Partial post-settlement refunds remain deliberately unsupported in B7R V1 and retain the existing safe rejection/manual-review behavior.
- A beneficiary balance below the aggregate immutable leg requirement produces a non-financial manual-review result; operations must recover the beneficiary funds before a later full-refund retry with a new idempotency key.
- No atomicity, duplicate-money, same-account aggregation, creator-leg, held-refund, release-seller, forward LIVE commission, or migration-isolation residual risk was observed in proof.

All local, disposable, regression, export, dry-run, deployment, parity, and remote post-deploy gates are complete. This record is finalized by the following verification commit; branch push and local/remote SHA equality necessarily occur afterward and are reported in the final handoff. No hard blocker has been established.
