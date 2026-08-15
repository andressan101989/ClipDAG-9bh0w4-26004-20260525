# MKT-B8S Admin Identity Hardening Execution Log

## Execution identity

- Branch: `codex/mkt-a4b-premium-integration`
- Starting SHA: `c055eb55b8948d5ae6e149ff97a6f8c502e00f23`
- Build: 22
- Starting remote migration: `20260811026000`
- Forward-only migration: `20260811027000_marketplace_admin_identity_hardening.sql`
- Scope: server-side admin identity security only. No `apps/admin-web`, B8A operational RPC, B8B mutation, mobile UI, financial formula, or EAS work.

## Original vulnerability

The historical `user_profiles_insert_self` and `user_profiles_update_self` policies checked only `auth.uid() = id`. The table also had table-wide INSERT and UPDATE grants for `authenticated` (and `anon`). PostgreSQL RLS selected the owned row but did not constrain privileged columns.

Disposable reproduction before the correction returned:

```json
{
  "ordinary_user_update_self_promoted": true,
  "ordinary_user_insert_self_admin": true
}
```

An ordinary user could therefore set `user_profiles.is_admin=true` and satisfy `marketplace_actor_is_admin()`. The helper itself correctly derives the user through `auth.uid()` and reads server state; the state was not protected.

## Profile-field audit

The deployed `public.user_profiles` contains 21 columns.

- Safe self-editable presentation/preferences: `username`, `display_name`, `avatar_url`, `bio`, `profession`, `website`, `location`, `wallet_address`, `is_private`, `hide_activity`, `allow_comments_from`, `allow_messages_from`, `push_token`.
- Creation-only identity data: `id`, `email`.
- Server-managed integrity: `followers_count`, `following_count`, `created_at`, `updated_at`.
- Privilege/security: `is_admin`.
- Server-managed economic cache: `dag_balance`. Canonical financial decisions use the ledger, but an authenticated client must still not alter this cache.

No moderator, verified, staff, role, suspension, permission, or capability column exists in `user_profiles`. Seller approval and Marketplace moderation live in separate protected authorities.

## Remediation

The migration applies defense in depth:

1. Removes historical table-wide INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER grants from `anon` and `authenticated`.
2. Grants `authenticated` INSERT/UPDATE only on the explicit compatibility columns needed by current profile creation/editing.
3. Does not grant either INSERT or UPDATE on `is_admin`.
4. Narrows INSERT/UPDATE RLS policies to the `authenticated` role and adds an INSERT check requiring default false/zero protected values.
5. Adds `protect_user_profile_server_fields()` as an invoker-context trigger with fixed `search_path=pg_catalog, public`.
6. The trigger rejects non-trusted INSERT/UPDATE changes to `is_admin`, `dag_balance`, follower counters, ID, and creation timestamp.
7. The trigger uses the real PostgreSQL execution role (`current_user`), not JWT/user metadata. Security-definer backend functions and database/service-role administration retain their established trusted execution context.

`dag_balance` remains accepted as zero during existing profile creation and as a no-op zero update for registration compatibility, but any value change is rejected. This avoids breaking current signup while removing authority to alter the cache.

## Legitimate provisioning

No public admin setter exists. Admin assignment remains database-operator/service-role only through a direct protected row update. Disposable proof confirms this path can grant and revoke `is_admin`, while anon/authenticated roles cannot execute the guard function or directly mutate the column.

## Disposable proof

`scripts/prove-marketplace-admin-identity-hardening.mjs` is hard-guarded to localhost/127.0.0.1 port 55422 and rolls back all users. It proves:

- anonymous denial;
- own-profile INSERT with `is_admin=true` denial;
- own-profile UPDATE false-to-true denial;
- cross-user denial;
- JWT user/app metadata forgery denial;
- zero exposed authenticated/anon admin setters;
- `dag_balance` and social counter mutation denial;
- ordinary helper result false and protected admin result true;
- trusted grant and revoke;
- normal profile creation and safe editing;
- effective grants/policies/trigger/search path;
- persistent fixtures zero.

## Blockers and resolutions

### B8S-01 — row ownership was mistaken for privilege authority

- STAGE: B8A prerequisite security audit
- ERROR / SQLSTATE: attacks succeeded; no SQL error
- SYMPTOM: ordinary INSERT and UPDATE both produced `is_admin=true`.
- ROOT CAUSE: table-wide DML plus owner-only RLS had no column privilege boundary or trigger.
- CLASSIFICATION: critical privilege escalation
- SOLUTION: narrowed grants, authenticated-only policies, protected-value INSERT checks, and invoker-context trigger.
- WHY THIS IS SAFEST: preserves normal profile creation/editing and the existing canonical admin helper without introducing a public admin-management API.
- PRODUCTION ECONOMICS CHANGED: No. The legacy profile balance cache is protected; canonical ledger authority is unchanged.
- STATUS: RESOLVED AND DEPLOYED.

### B8S-02 — compatible signup supplies `dag_balance: 0`

- STAGE: profile compatibility audit
- ERROR / SQLSTATE: potential permission regression if the column were simply revoked on INSERT/UPDATE
- SYMPTOM: current signup/profile recovery explicitly supplies or replays zero.
- ROOT CAUSE: legacy client compatibility predates canonical ledger architecture.
- CLASSIFICATION: compatibility issue
- SOLUTION: allow the column in the narrow grant but trigger-reject any INSERT other than zero and any UPDATE that changes the stored value.
- WHY THIS IS SAFEST: signup remains functional while clients gain no balance-changing authority.
- PRODUCTION ECONOMICS CHANGED: No.
- STATUS: RESOLVED AND DEPLOYED.

### B8S-03 — pre-deploy auditor resolved an absent future function eagerly

- STAGE: remote pre-deploy audit
- ERROR / SQLSTATE: PostgreSQL function lookup failed before B8S existed.
- SYMPTOM: the first `--expect-pre-b8s` audit attempted `has_function_privilege` with a function signature that was intentionally absent.
- ROOT CAUSE: the catalog expression resolved the future function name before applying the pre-B8S conditional.
- CLASSIFICATION: audit tooling issue
- SOLUTION: gate privilege inspection through `to_regprocedure` and evaluate it only when the function exists.
- WHY THIS IS SAFEST: the auditor remains read-only and can accurately distinguish the expected pre- and post-migration states.
- PRODUCTION ECONOMICS CHANGED: No.
- STATUS: RESOLVED; both pre- and post-deploy audits passed.

## Final gates

- Baseline read-only B7E audit: passed at remote migration `20260811026000`; inherited Marketplace, LIVE, Ads, escrow, fixture, and failure-hook gates were healthy.
- B8S pre-deploy read-only audit: passed; B8S absent as expected and remote latest remained `20260811026000`.
- Disposable attack proof: passed. Anonymous helper result was false; self-admin INSERT, self-admin UPDATE, authenticated admin self-demotion, cross-user mutation, metadata forgery, balance mutation, and social-counter mutation were denied. Protected service-role/database provisioning grant and revoke passed. Normal creation and safe editing passed. Fixtures: 0.
- Focused static tests: 10/10 passed.
- Root Node suite: 661/661 passed, 0 failed.
- Focused ESLint: 0 errors and 0 warnings.
- TypeScript: exactly 187 pre-existing unrelated diagnostics; no B8S diagnostics and no baseline increase.
- iOS export: succeeded; Build remained 22; no EAS command ran.
- Marketplace regressions: B7E healthy; B7D 18/18; B7C 28/28; B7B 23/23; B7A 36/36; B7F 27/27; B7R 32/32; B3 analytics, disputes/refunds, order lifecycle, shipping, and client runtime passed.
- Source safety: one forward-only security migration; no historical migration edit, Web Admin application, Expo UI, B8A/B8B authority, Marketplace financial formula, ledger authority, or EAS change.
- Linked dry-run: exact single migration `20260811027000_marketplace_admin_identity_hardening.sql`; seeds `[]`; roles `[]`.
- Deployment: exact B8S migration applied successfully.
- Post-deploy read-only audit: passed at remote latest `20260811027000`; guard and trigger present; direct privileged column grants denied; no exposed admin setter; fixtures 0; failure hooks absent; escrow 71/71; all inherited reconciliation counters zero.
- Commits: `fix: harden marketplace admin identity authority` and `test: prove marketplace admin identity hardening`; no amend, rebase, squash, merge, or force push.

## Final status

MKT-B8S Admin Identity Hardening is CLOSED. MKT-B8A is safe to resume but has not been resumed in this phase.
