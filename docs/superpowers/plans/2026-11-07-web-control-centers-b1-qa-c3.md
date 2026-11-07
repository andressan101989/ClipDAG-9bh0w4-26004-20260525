# WEB-CONTROL-CENTERS-B1-QA-C3 Implementation Plan

**Spec:** Owner authorization in the active conversation for `WEB-CONTROL-CENTERS-B1-QA-C3`.

**Goal:** Restore authenticated cloud-draft listing and make the existing draft inbox truthful and recoverable on iOS without changing any adjacent authority.

**Architecture:** Keep the existing B1 draft RPC, service, `DraftManager`, route, media reservations, and CAS authority. Replace only the invalid schema-qualified PostgreSQL conditional expressions in the RPC. The client keeps the last successful data while distinguishing loading, error, empty, and populated states; it exposes a bounded retry and ensures the active Drafts tab is visible. No second backend, draft manager, media system, or publication path is introduced.

**Tech Stack:** PostgreSQL/Supabase migrations, Expo Router, React Native, Node test runner, PGlite disposable proof, TypeScript, ESLint, canonical Nelyon release workflow.

---

### Task 1: Regression contract for the draft-list RPC

**Files:**
- Add: `tests/webControlCentersB1QaC3DraftRecovery.test.mjs`
- Modify: `scripts/prove-web-control-centers-b1-disposable.mjs`

1. Add a contract test that requires one new migration and rejects `pg_catalog.least` / `pg_catalog.greatest` in the corrected RPC.
2. Extend the disposable proof to reproduce SQLSTATE `42883` on the old definition, then prove authenticated owner isolation, cursor pagination, bounded limits, invalid cursor rejection, and a true empty result on the corrected definition.
3. Run the focused tests and preserve the expected RED result before implementation.

### Task 2: Forward-only SQL repair

**Files:**
- Add: one CLI-generated migration under `supabase/migrations/`

1. Generate the migration using the repository's Supabase CLI.
2. `CREATE OR REPLACE` only `public.list_my_publication_drafts_v1(integer,timestamptz,uuid)`.
3. Preserve signature, `STABLE`, `SECURITY DEFINER`, empty `search_path`, `auth.uid()` ownership filter, cursor semantics, ordering, limit bounds, owner, and grants.
4. Replace only the invalid schema-qualified conditional expressions with PostgreSQL-valid `greatest(...)` and `least(...)` expressions.
5. Run the focused SQL/disposable/security tests to GREEN.

### Task 3: Truthful Drafts inbox and retry

**Files:**
- Modify: `app/my-content.tsx`
- Modify: `tests/webControlCentersB1QaC2Navigation.test.mjs`
- Modify/Add focused QA-C3 component tests as required

1. Add failing component tests for a populated cloud draft, true empty result, RPC error, retry success, deep-link tab visibility, and stale-response fencing.
2. Preserve existing data on refresh errors and render an explicit error state with a controlled retry instead of `Sin borradores`.
3. Render the active Drafts section label and keep the Drafts chip visible when opened via `?tab=drafts`.
4. Reuse `DraftManager` and the existing restore/update/delete/publish handlers; do not add a second service or screen.
5. Verify a restored photo draft retains its canonical asset references and never publishes automatically.

### Task 4: Governance, verification, and independent review

**Files:**
- Modify only governance artifacts required by the canonical release compiler for the exact migration manifest.

1. Update the release contract for exactly one migration and zero Edge Functions.
2. Run focused tests, PostgreSQL disposable proof, B1 regressions, TypeScript, focal ESLint, Expo bundle/build checks, release-gate tests, and `git diff --check`.
3. Request independent code review against the authorization and fix every Critical/Important finding.
4. Re-run fresh verification on the reviewed tree.

### Task 5: Protected integration and canonical production release

1. Commit and push the focal branch; open a protected PR to `main`.
2. Confirm exact files, checks, review, mergeability, and no unexpected commits; rebase-and-merge through protection.
3. Run fresh `plan_only`, verify the exact manifest, run `gate_proof`, backup/snapshot, and release HIGH.
4. Verify the migration applied exactly once, the authenticated RPC returns the preserved private draft, and no production content or financial mutation occurred.
5. Promote the post-release baseline through a separate protected PR, synchronize the policy digest, and obtain `NO PRODUCTIVE CHANGES` from a final plan.

### Task 6: Expo/Metro physical-QA bridge

1. Verify the existing Metro/ngrok processes and their ownership.
2. Replace only this project's stale Metro process, preserving the authorized tunnel when safe.
3. Serve the final integrated `origin/main` SHA with a clean cache, prove manifest and bundle HTTP 200/source parity, and provide the tunnel URL.
4. Leave physical PASS pending until the owner confirms recovery on the iPhone.
