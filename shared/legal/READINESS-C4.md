# NPW-F-C4 internal pre-activation audit

This is review evidence, not legal text or an alternative authority. `decisions.ts` and `manifest.ts` remain the machine-readable authorities. Neither draft is approved or active.

## Age enforcement: NOT_ENFORCED

- `app/login.tsx:48-68` accepts email, password, confirmation and username; it neither requests birth date nor checks adulthood before calling `register`.
- `contexts/AuthContext.tsx:292-304` validates required fields and password length, then calls `supabase.auth.signUp` with username metadata only.
- `supabase/migrations/20260703212533_migration_to_supabase.sql:46-68` defines `user_profiles` without birth date or age-verification fields. No age-enforcement migration or canonical validation was found in the audited repository. Remote production enforcement was not independently verified.
- The resulting account can enter the general authenticated tabs; no independent Social, Chat, LIVE, Marketplace or Business age gate was established by the code search. Business has separate role/capability authorization, not an age proof.
- `app/terms-of-service.tsx:220-227` remains a visible protected legacy contradiction: 13+ and guardian consent for 13–17. `app/legal.tsx` also has historic age language. Neither file may be edited in C4.

**Hard production gate:** design and authorize a canonical, server-enforced registration eligibility mechanism across every registration path, decide how existing accounts and unknown ages are handled, and reconcile protected legacy legal routes. A UI-only date field/check is insufficient for guaranteeing 18+. No KYC vendor, DOB storage, identity system or DB migration is authorized here.

## Remaining activation / publication gates

| Gate | Required evidence or decision | After resolution |
| --- | --- | --- |
| Entity registration | Verify the actual Florida registration of the owner-selected Nelyon, Inc.; owner-provided address is not proof | Promote verified identity in manifest, review exact public wording |
| Official channels | Establish and verify support, privacy, legal and copyright contacts; account-deletion request channel remains unimplemented | Populate and approve contact decisions and operational deletion route |
| Age enforcement and legacy consistency | Implement and verify 18+ enforcement across registration; reconcile active 13+ mobile text | Test all callers and protected content migration with separate authorization |
| Legal review | Counsel review of exact Privacy/Terms including BDAG/finance, content license, disputes, retention, providers and international handling; verify per-flow fee disclosures rather than assuming they exist | Record legal approval against exact content fingerprints |
| Effective dates | Select launch-effective dates, not build dates | Populate approved document metadata |
| Locales | Review/approve exact translations intended for launch | Populate available locales only for reviewed content |
| Final owner signoff | Approve exact final wording after all above changes | Bind owner approvals to exact content fingerprints and activate in a separate phase |

No C4 action changes mobile legal routes, the public legal pages, database, financial code, production, Cloudflare or DNS.
