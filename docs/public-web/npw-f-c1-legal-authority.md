# NPW-F-C1 — Shared legal authority foundation

This phase creates **technical infrastructure only**. `shared/legal/manifest.ts` is the sole future manifest for Privacy and Terms. Both entries are `pending_approval`; identity, contacts, versions, dates and approved locales are null or empty. `legalDocuments` is empty. Nothing in this directory is a policy effective for users.

## Contract

- Canonical IDs: `privacy`, `terms`. Locale schema: `en`, `es`, with `fr` and `pt` supported but no translations supplied.
- Renderer-neutral sections contain plain-text paragraphs, lists and contact references. Raw HTML is rejected. Renderers must still escape text normally.
- `resolveLegalDocument` requires an approved manifest entry, reviewed legal entity/jurisdiction/address, valid dates/version/locales, exactly one matching content document and matching version. It fails closed for pending, retired, unavailable or duplicate content. A referenced contact must be verified; it is never silently omitted.
- `resolveLegalContact` emits only verified, conservatively validated email values. The new manifest contains no legacy addresses. The `TEST_ONLY` addresses in tests are not imported by production adapters.
- `fingerprintLegalDocument` is a deterministic FNV-1a change detector over canonicalized document ID, locale, version, title, anchors and blocks. It excludes manifest status, contact values and effective/updated dates. It is **not a cryptographic signature** and does not replace the existing SHA-256 legacy-file audit. A future approved-content release should record a SHA-256 of the reviewed canonical document as release evidence.
- The Expo and Astro adapters import only this shared authority. They have no runtime fetch, database dependency or platform-specific dependency in the shared layer. Neither current UI route imports its adapter yet.

## Route and content migration — requires separate approval

| ID | Existing mobile route | Future public route | Current state |
| --- | --- | --- | --- |
| Privacy | `/privacy-policy` | `/privacy` | Independent 2026 mobile text; public shell |
| Terms | `/terms-of-service` | `/terms` | Independent 2026 mobile text; public shell |

`/legal` remains an active mobile hub. Its Privacy/Terms cards will eventually point to the same approved mobile authority, but no redirect or visible behavior changes in C1. Its Community, Copyright, Monetization and Cookies documents remain `legacy_active_review_required` conceptually and are **outside** the initial Privacy/Terms authority. Their financial and operational claims must not be copied into the new manifest without review.

Before activation: the owner/legal reviewer must approve identity, jurisdiction, address, contacts, eligibility, disputes, economics, actual privacy practices, translations, versions and effective dates. Add reviewed content once to `shared/legal`, change the relevant manifest entry to `approved`, preserve anchors as needed, and verify equivalent mobile and Astro rendering. Only then migrate callers and replace public shells. Keep the old mobile routes for compatibility until callers and released versions are accounted for.

## Moderation provenance

`supabase/migrations/20260914163245_admin_content_safety_policy_text_rules_v1.sql` permits rule references shaped `terms#<anchor>` plus a policy version. The migration does not seed concrete references. No DB state was queried or changed in C1. Before retiring old Terms, audit approved rules in the appropriate authorized phase and map each actual `terms#` reference to a reviewed section ID/version or explicitly retire the rule. Do not silently repoint references.

| Moderation provenance field | Proposed canonical counterpart | Migration condition |
| --- | --- | --- |
| `policy_reference = terms#<anchor>` | `shared/legal` Terms `sections[].id` | Preserve an anchor only when its meaning is still approved; otherwise retire or reapprove the rule. |
| `policy_version` | `legalManifest.documents.terms.version` | Record the reviewed version, never infer it from a Git SHA. |
| `locale` | `LegalDocument.locale` | Confirm that the referenced section exists in that reviewed locale. |

## Legacy protections

`tests/nelyonBranding.test.mjs` pins visible legal/financial copy and legacy contacts. `tests/adminContentSafetyPolicyF5.test.mjs` pins SHA-256 hashes of the three mobile files. Both remain untouched in C1; a later content migration must update them deliberately with approval and a traceable baseline. Current mobile routes, `/legal`, `/privacy` and `/terms` must remain visually unchanged until that migration.
