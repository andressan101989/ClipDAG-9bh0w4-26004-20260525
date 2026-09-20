# Nelyon 18+ eligibility: B1 boundary contract

Status: foundation only. The owner policy is 18+, without parental override. This file is an internal implementation contract, not a user-facing eligibility claim or legal document. The Before User Created hook remains inactive. No access check is attached to current Data API, RPC, Storage, Realtime, Edge, Mobile, or Business flows in B1.

## Authorities and data

- `private.age_eligibility_policy` has one row: minimum age 18 and version `nelyon-age-v1`. `shared/legal/decisions.ts` records the same owner decision for legal drafting; it does not authorize runtime access.
- `private.user_age_eligibility` is the only runtime eligibility record. No DOB, email, profile, or financial field is stored there. `eligible` and `ineligible` require a server evaluation timestamp; `unknown_legacy` has none.
- A missing row means `unknown_legacy` and deny normal access **when enforcement is connected in B3**. B1 deliberately does not change present access. Existing users remain rowless, not inferred adult or underage.
- `private.age_evaluate_dob` is the only server age calculation. Input is strict `YYYY-MM-DD`; the comparison date is the server's UTC calendar date. An exact eighteenth birthday passes. Feb 29 reaches the age boundary on Mar 1 in a non-leap anniversary year. Missing, malformed, and future dates return `unknown_legacy`, which the prepared hook rejects.
- DOB will be submitted as signup Auth metadata in B2. That metadata can persist and can be edited by a user; it is never an authorization authority after server evaluation. B1 neither collects nor scrubs DOB. Do not promise deletion until a tested lifecycle exists.

## Hook and race contract

`private.age_before_user_created` is installed as an inert, execute-restricted Postgres function. Its future URI is `pg-functions://postgres/private/age_before_user_created`; no Auth setting points to it in this migration. The hosted remote Auth Hook setting and provider configuration remain `UNKNOWN_REMOTE` until independently verified. Do not enable this hook or change signup UI in B1.

The future sequence is: signup with DOB -> Before User Created computes 18+ and rejects non-eligible input -> `auth.users` insert -> trusted server materialization recalculates eligibility and writes the private row -> transaction commits -> first usable token -> normal API access. The hook runs before the user row exists, so it cannot insert an FK-linked eligibility row. B2 must prove an `auth.users` AFTER INSERT mechanism (or another trusted atomic mechanism) in an isolated environment before attaching it. A client callback is not sufficient. No trigger is attached in B1.

If materialization fails, signup must fail atomically or the first token must remain unusable for normal resources. If a row is delayed or absent, `current_user_is_age_eligible()` returns false; retries cannot treat an absent row as eligible. A stale token or token refresh cannot promote a missing/ineligible row. Before B3, test actual first-token timing and fail-closed behavior against Data API, RPC, Storage, Realtime, and Edge. Never interpret a successful hook response alone as an eligibility record.

The future remediation command accepts DOB, never status or `isAdult`. The server computes the result and atomically sets `eligible` or `ineligible`; unknown accounts have only the remediation and resolution capabilities. Repeated identical requests should be idempotent; conflicting retries, previously ineligible accounts, and concurrent requests need an explicit audited rule before activation. No client may update the table directly. An ineligible person is not automatically deleted, suspended, or deprived of financial rights.

## Boundary matrix for B3/B4

| Boundary | Current authority | Future check and normal result | Unknown/ineligible exception | Phase |
| --- | --- | --- | --- | --- |
| Data API | Grants plus RLS, often `auth.uid()` | Pre-request consults the private eligibility helper; eligible continues | Only tightly allowlisted remediation/account-resolution endpoints | B3 |
| RPC | EXECUTE grants; many SECURITY DEFINER functions | Same Data API pre-request for PostgREST calls, plus sensitive-function review | Remediation RPC and audited resolution RPCs only | B3/B4 |
| Storage | `storage.objects` folder ownership policies | Explicit policies consult the same authority; audit public bucket reads separately | No normal uploads/mutations; necessary records handled through resolution | B3 |
| Realtime | Publication RLS and `realtime.messages` policies | Age-aware policies and channel/session tests using the same authority | No normal subscriptions; disconnect/refresh behavior must be verified | B3 |
| Edge Functions | JWT validation and per-function checks, sometimes service-role clients | Shared guard checks the private authority before privileged user operations | Separate webhook/job auth; audited resolution endpoints | B3/B4 |
| Mobile | Existing AuthContext and Expo router | Session state directs legacy unknown to remediation; server checks remain authoritative | Limited remediation and support, not normal tabs/deep links | B4 |
| Business | Existing BusinessAuthProvider, returnTo, invitation RPC | Same eligible authority before Business operations | Invitee with no account passes 18+ signup; unknown remediates; ineligible cannot activate membership | B4 |
| Finance | Existing ledger/wallet/settlement authorities | Eligibility restriction never mutates balances or ownership | Financial resolution, refunds, disputes, payouts and record access require separate audited path | B4 |

No single Postgres hook covers all these boundaries. `pgrst.db_pre_request` covers only PostgREST, not Storage or Realtime. No 102 existing public policies are changed by B1.

## B2/B3 hard gates

1. Verify remote Auth Hook inventory and provider settings; preserve any existing hooks. The same hook must cover every enabled new-user provider. Auth Hook activation requires separate owner approval.
2. Prove transaction/first-token ordering with a disposable non-production account and full cleanup; a failed materialization must not leave an eligible session without a row.
3. Confirm the private schema hook URI works in the hosted project and `supabase_auth_admin` has only the required permissions.
4. Confirm the DB helper and policy version fail closed for missing, stale, unknown, and ineligible states. Do not use mutable Auth user metadata or a stale JWT claim as sole authority.
5. Map all Data API/anon, RPC SECURITY DEFINER, Storage public-read, Realtime, and deployed Edge bypasses before B3. Verify financial resolution for existing users before B4.
