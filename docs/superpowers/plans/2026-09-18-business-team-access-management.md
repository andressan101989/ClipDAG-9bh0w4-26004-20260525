# Business Team Access Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure multi-business Team, invitation, preset, and capability management on the existing BW-J1 authorization authority.

**Architecture:** Three private adapter/audit tables support pre-membership invitation lifecycle while BW-J1 membership and capability tables remain runtime authority. Two read RPCs and one command RPC enforce owner/delegated-manager rules server-side; Business Web consumes typed projections and derives role presets locally.

**Tech Stack:** PostgreSQL/Supabase RLS and `SECURITY DEFINER`, React 19, React Router 7, TypeScript, Vitest/Testing Library, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-18-business-team-access-management-design.md`

## Global Constraints

- Preserve `private.business_memberships`, `private.business_membership_capabilities`, `private.business_effective_capabilities()`, and `private.business_actor_has_capability()` as the only access authority.
- Presets are UI-only exact capability sets; create no persistent role authority.
- Protected capabilities are exactly team.manage, settings.manage, finance.read, payouts.read, and payouts.manage.
- No finance, ledger, wallet, escrow, Stripe, payout, Ads, or Analytics authority changes.
- Use one forward-only migration, one final commit, fast-forward push, and no persistent fixtures.

---

### Task 1: Prove the database contract in tests

**Files:**
- Create: `tests/businessTeamAccessBwJ2.test.mjs`
- Create: `supabase/tests/business_team_access_bw_j2.sql`

**Interfaces:**
- Consumes: BW-J1 membership/capability tables and helper functions.
- Produces: executable expectations for the migration and runtime security model.

- [ ] Write static tests asserting exactly three private J2 tables, no role table, one command RPC, two read RPCs, exact grants/search paths, protected capability enforcement, server-derived email, append-only audit, and no finance references.
- [ ] Run `node --test tests/businessTeamAccessBwJ2.test.mjs` and confirm it fails because the migration does not exist.
- [ ] Write rollback SQL fixtures covering owner, reader, delegated manager, protected grants, self/manager protection, invitation accept/decline/revoke, cross-business denial, reactivation, and runtime revocation.

### Task 2: Implement canonical invitation and Team server authority

**Files:**
- Create: `supabase/migrations/<generated>_business_team_access_management_bw_j2.sql`

**Interfaces:**
- Produces: `public.get_my_business_team(uuid) -> jsonb`, `public.get_my_pending_business_invitations() -> jsonb`, and `public.manage_business_team(text,jsonb) -> jsonb`.

- [ ] Create the migration through `supabase migration new business_team_access_management_bw_j2`.
- [ ] Add the three private force-RLS tables, constraints, minimal indexes, deny policies, revoked direct ACLs, and immutable audit trigger.
- [ ] Implement read projections with PII minimization and team.read/team.manage/owner gates.
- [ ] Implement the centralized command RPC with row locks, email normalization, capability validation, protected-capability/delegation rules, atomic replacement, and sanitized audit events.
- [ ] Run static tests until green.
- [ ] Apply the migration to production only after review and run the rollback SQL proof.

### Task 3: Define typed client contracts and preset semantics

**Files:**
- Create: `apps/business-web/src/lib/businessTeamApi.ts`
- Create: `apps/business-web/src/lib/businessTeamPresets.ts`
- Create: `apps/business-web/src/tests/businessTeamApi.test.ts`
- Create: `apps/business-web/src/tests/businessTeamPresets.test.ts`

**Interfaces:**
- Produces: strict Team/invitation payload parsers, read/command wrappers, `TEAM_PRESETS`, and `deriveTeamPreset(capabilities)`.

- [ ] Write failing parser tests for minimized identity, catalog, member, invitation, and command receipts.
- [ ] Write failing exact-set tests for Viewer, Operations, Marketing, Finance, Manager, and Custom.
- [ ] Run the focused tests and confirm expected missing-module failures.
- [ ] Implement strict parsing and the single RPC wrapper without direct table access.
- [ ] Implement exact preset sets, domain grouping, and protected capability metadata.
- [ ] Run focused tests until green.

### Task 4: Add Team and invitation UI

**Files:**
- Create: `apps/business-web/src/pages/team/BusinessTeamPage.tsx`
- Create: `apps/business-web/src/pages/team/BusinessInvitationInboxPage.tsx`
- Create: `apps/business-web/src/tests/BusinessTeam.test.tsx`
- Modify: `apps/business-web/src/App.tsx`
- Modify: `apps/business-web/src/layout/BusinessLayout.tsx`
- Modify: `apps/business-web/src/styles/business.css`

**Interfaces:**
- Consumes: current `BusinessAuthProvider`, Team API, preset utilities.
- Produces: capability-gated `/team` and authenticated `/invitations` experiences.

- [ ] Write failing UI tests for owner full catalog, reader read-only, manager constrained controls, presets/Custom, sensitive badges, invitation lifecycle, invitee accept/decline, and retry after acceptance.
- [ ] Run focused UI tests and confirm route/component failures.
- [ ] Implement the responsive Team page with business-scoped request identity, loading/empty/error states, member list, invitation list, invite dialog, permission editor, copy link, and revocation confirmation.
- [ ] Implement the authenticated invitation inbox accessible without an active business and refresh BW-J1 access after acceptance.
- [ ] Enable capability-aware navigation and route guards; make team.manage imply Team read only here.
- [ ] Add focused CSS using existing Business tokens and dialog/card/table patterns.
- [ ] Run focused UI tests until green.

### Task 5: Harden provider refresh and regressions

**Files:**
- Modify: `apps/business-web/src/auth/BusinessAuthProvider.tsx` only if tests show refresh selection cleanup is insufficient.
- Modify: `apps/business-web/src/tests/BusinessApp.test.tsx`

**Interfaces:**
- Consumes: existing `retry()` and selected-business reconciliation.
- Produces: immediate post-accept access refresh and safe removal of revoked current business on refresh.

- [ ] Add failing tests for Team navigation, team.manage read implication, acceptance refresh, revoked current-business clearing, and multi-business switch isolation.
- [ ] Make the minimum provider/routing change required by those tests.
- [ ] Run the Business full suite until green.

### Task 6: Verify, deploy, review, and publish

**Files:**
- Modify only files already listed if verification finds an in-scope defect, with a failing regression test first.

**Interfaces:**
- Produces: applied migration, clean advisors, verified production counts, one commit, and synchronized remote.

- [ ] Run J2 static and SQL security proofs, Business Web full tests/lint/build, BW-I/BW-H/BW-G/Ads/Seller regressions, Admin suite/lint/build, and `git diff --check`.
- [ ] Run security and performance advisors; explain global pre-existing findings and resolve any new J2 finding.
- [ ] Confirm memberships, membership capabilities, invitations, and audit events have no fixture residue; confirm financial counts and external rails are unchanged.
- [ ] Self-review the diff against the specification and remove duplicate/orphan paths.
- [ ] Commit once as `feat(business): add team access management`.
- [ ] Fetch, verify fast-forward eligibility, push normally, and confirm HEAD equals upstream with a clean worktree.
