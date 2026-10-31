# Admin Web protected production release

The Admin SPA is released only by `.github/workflows/nelyon-production-release.yml` from an exact approved `origin/main` SHA. This runbook does not authorize a manual Cloudflare deployment.

## Immutable plan

Every `plan_only`, `gate_proof`, and `release` run creates a separate `nelyon-admin-plan-<run>-<attempt>` artifact. Its canonical manifest binds the approved SHA, changed Admin paths, every tracked Admin/deployment input hash, the pinned Wrangler version, the Worker name, and the only authorized routes:

- `nelyon.app/admin`
- `nelyon.app/admin/*`

`gate_proof` verifies those exact bytes without receiving Cloudflare credentials or running a mutating command.

## Release order

For `mode=release`, the protected `production` Environment and the existing HIGH release gate remain authoritative. Before any productive mutation, the workflow:

1. verifies the canonical Supabase and Admin manifests;
2. resolves the canonical public Supabase build configuration through the already-authorized Supabase control plane;
3. installs from `apps/admin-web/package-lock.json`;
4. builds twice and requires byte-identical output inventories;
5. records the current single-version Cloudflare deployment and current route inventory.

Only after the Supabase postcheck succeeds does the workflow upload one immutable Worker Version. It smokes the exact Version preview URL, promotes that exact Version ID at 100%, proves active-version equality, applies the two explicit routes, and verifies the production HTTP matrix. `wrangler deploy` is not an authorized production path.

## Fail-closed and recovery

The workflow stops before upload if the Worker lacks one unambiguous 100% prior version, if preview hosting cannot prove the exact uploaded Version, if route ownership conflicts, or if the reproducible build differs.

If any step after candidate attestation fails, the workflow redeploys the exact prior Version ID at 100%, removes only Admin routes added by the failed attempt, verifies the restored route state, and records a separate recovery artifact. A recovered failed run remains failed and must be investigated; recovery is not a PASS.

## External prerequisites

- The GitHub `production` Environment must retain its reviewers/branch protection and the existing canonical release variables.
- It must provide the existing Supabase access token and a least-privilege `CLOUDFLARE_API_TOKEN` capable only of reading the account/zone, uploading and deploying `nelyon-admin-web` Versions, and managing the two Admin routes.
- The Cloudflare account must expose an exact Version preview URL. No substitute preview host, DNS change, custom domain, or secret value may be invented by the workflow.
- The existing `nelyon-admin-web` Worker must have one recoverable active Version before route cutover.

The workflow stores sanitized manifests, version identifiers, route inventories, HTTP hashes/statuses, and recovery evidence. It never uploads the Cloudflare token, Supabase token, public-key response file, or raw response bodies as artifacts.
