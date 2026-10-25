# Creator Premium F3 Final Wallet Integration Plan

**Goal:** Close the verified Wallet BDAG integration gaps without activating production finance or creating another financial authority.

**Architecture:** Keep `ledger_accounts`, `financial_transactions`, `ledger_entries`, the F2/F3 RPCs, and `bdag-ledger` as the only authorities. Add a narrow authenticated self-provisioning wrapper around the existing service-only account provisioner, derive wallet history amounts from the immutable Creator Premium gross/fee snapshot under the validated B4 contract, and extend the existing platform-revenue projection to Creator Premium facts.

## 1. Wallet transaction presentation

- Add RED unit cases for Creator Premium purchase, subscription, purchase refund, and subscription-period refund from buyer, creator, and platform perspectives.
- Require buyer views to show gross and creator views to show canonical `gross - fee`, matching the validated ledger split without inventing a second accounting authority.
- Preserve existing legacy classifications and make Premium creator credits count as earned.
- Implement the smallest presenter/useWallet change and rerun wallet tests.

## 2. Canonical self-provisioning

- Add RED contract and PostgreSQL cases proving signup cannot call the service-only `ensure_ledger_account` directly and proving an authenticated user can provision only their own zero-balance BDAG account.
- Add one forward-only migration with a hardened `SECURITY DEFINER`, empty `search_path`, authenticated-only wrapper that delegates to `ensure_ledger_account(auth.uid())` and returns only the caller's account id.
- Update signup to call the self wrapper and handle the Supabase `{ error }` result without blocking registration.
- Prove arbitrary-user provisioning, anon access, duplicates, balance creation, and account mutation are denied.

## 3. Creator Premium platform revenue

- Add RED PostgreSQL/contract cases showing the existing platform revenue projection omits Premium fees and refunds.
- Extend the existing projection rather than creating a second KPI authority; recognize verified Premium charge/refund facts and calculate net platform fee revenue from canonical ledger-backed facts.
- Preserve existing LIVE/Marketplace/Ads/withdrawal sources, pagination/ranges, capabilities, RLS/ACL, and Finance OFF.

## 4. Verification and integration

- Run disposable PostgreSQL tests for provisioning, purchase/subscription/refund/reconciliation, plus Wallet unit suites, Admin revenue suites, F1/F2/F3/MEDIA/P3 regressions, TypeScript, ESLint, and `git diff --check`.
- Run independent code review and resolve Critical/Important findings.
- Create a protected PR and merge only after checks are green.
- If SQL/Edge changes remain, run canonical `plan_only` and `gate_proof`; stop before any productive release gate requiring a new decision. Keep Finance OFF and execute no real BDAG movement.
