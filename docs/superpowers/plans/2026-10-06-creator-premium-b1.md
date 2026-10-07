# Creator Premium B1 Implementation Plan

> **Execution scope:** One forward-only migration, a narrow client metadata service, runtime legacy hardening, focused tests, production migration deployment, and branch delivery. No Premium media originals, financial movement, Edge deployment, or B2 work.

**Goal:** Establish the single private Creator Premium domain and a server-derived entitlement authority while making every active legacy Premium surface honest and non-operational until later phases.

**Architecture:** Seven `private` tables hold lifecycle, immutable offer facts, plans, plan grants, receipt facts, subscription relationships, and paid periods. They expose no direct client privileges. Hardened `SECURITY DEFINER` RPCs derive the actor from `auth.uid()`, reuse the canonical 18+ check, enforce account/block/moderation state, and return bounded metadata only. Entitlement is derived at read time; there is no entitlement cache and no media URL in B1.

**Technology:** PostgreSQL/Supabase migration and RPCs, TypeScript Supabase client service, React Native/Expo routes, Node test runner, local disposable PostgreSQL validation.

---

## Task 1: Freeze the contract with failing tests

**Files:**
- Create: `tests/creatorPremiumB1CanonicalFoundation.test.mjs`
- Create: `tests/creatorPremiumB1ClientHardening.test.mjs`

1. Assert the single migration, seven private tables, RLS/FORCE RLS, constraints, grants, age authority reuse, account/block checks, bounded keyset RPCs, finance references, and stale RPC revocation.
2. Assert active client paths use the B1 service/foundation state and do not invoke missing Premium tables or `bdag-economy` Premium actions.
3. Run both tests and confirm they fail before implementation.

## Task 2: Build the canonical database foundation

**Files:**
- Create with CLI: `supabase/migrations/*_creator_premium_b1_canonical_foundation.sql`

1. Create the seven private tables, explicit constraints, composite ownership foreign keys, and supporting indexes.
2. Enable and force RLS; revoke all direct privileges from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
3. Add private operational/block/entitlement helpers and narrow public catalog, owner, entitlement, and library RPCs.
4. Derive callers only from `auth.uid()`, reuse `private.current_user_is_creator_exclusive_age_eligible()`, validate pagination strictly, and expose no media/finance internals.
5. Revoke authenticated execution on the stale legacy cancellation RPC without dropping it.

## Task 3: Prove database behavior in a disposable environment

**Files:**
- Create: `tests/creatorPremiumB1Local.integration.mjs`

1. Bootstrap only the canonical dependencies plus the candidate migration in an isolated PostgreSQL database/container.
2. Prove table ACL/RLS, cross-user denial, 18+ gating, draft-only mutations, stale RPC revocation, lifecycle visibility, keyset pagination, and safe payloads.
3. Prove entitlement for owner, completed purchase, paid subscription, expiry, revocation, moderation state, account suspension, and bidirectional blocks.
4. Roll back/drop all disposable fixtures.

## Task 4: Add the B1 client contract and harden active legacy paths

**Files:**
- Create: `services/creatorPremiumService.ts`
- Modify only as needed: `services/creatorService.ts`, `services/economyService.ts`, `services/subscriptionService.ts`, `services/premiumDmService.ts`
- Modify only as needed: `app/creator/[id].tsx`, `app/creator-monetization.tsx`, `app/my-subscriptions.tsx`, `app/chat/[userId].tsx`, `app/(tabs)/messages.tsx`

1. Add typed calls to the B1 catalog/owner/library/entitlement RPCs.
2. Disconnect active reads from absent legacy tables.
3. Make purchase/subscription/Premium-DM mutations fail locally with a stable foundation-unavailable result; never invoke undeployed `bdag-economy` or stale RPCs.
4. Preserve the creator profile and Exclusive tab shell while showing an honest foundation state with no fake media, earnings, or purchase affordance.

## Task 5: Verification, dry-run, production migration, and postcheck

1. Run focused/static/integration tests, relevant media/age/finance/profile regressions, root suite where operational, TypeScript baseline comparison, changed-file ESLint, and `git diff --check`.
2. Re-fetch production migrations and Edge versions/hashes; stop on drift.
3. Run linked migration dry-run and require exactly the B1 migration.
4. Apply only the B1 migration; do not deploy Edge Functions.
5. Verify migration 331, schemas/ACLs/RPC grants, empty B1 finance facts, unchanged ledger/financial counts and balances, absent legacy tables, stale RPC revocation, and unchanged Edge hashes.
6. Run security and performance advisors and classify B1 findings.

## Task 6: Deliver the branch

1. Review the exact diff and ensure no unrelated files.
2. Commit in no more than three coherent commits.
3. Push normally to `codex/creator-premium-b1-canonical-foundation`.
4. Fetch and prove local/remote SHA parity and a clean worktree.
