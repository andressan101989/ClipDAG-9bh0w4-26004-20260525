# Release Governance G1 Design

## Decision

Replace the per-release, 900-second Supabase Dashboard screenshot contract with one persistent owner declaration:

`SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED=OFF`

The declaration is an expected configuration, not an observation. Until Supabase exposes a reliable documented read API for the GitHub Integration **Deploy to production** toggle, every gate proof must report:

- expected state: `OFF`;
- declared state: `OFF`;
- observed state: `UNAVAILABLE`;
- independently verified: `false`;
- residual risk: configuration drift cannot be detected directly by the provider API.

Missing, `ON`, or any unknown declaration fails closed. A valid declaration allows the release gate to proceed only when every existing independent control also passes.

## Existing contract

The workflow currently reads `NELYON_AUTO_DEPLOY_OFF_EVIDENCE_B64`, decodes a dashboard evidence record into the release artifact, compares the same bytes in the protected job, validates its digest and owner/project binding, and rejects records older than 900 seconds.

The one-time cutover evidence in the policy remains historical audit evidence only. It must never be described as current verification.

## New contract

The protected production Environment owns `SUPABASE_GITHUB_AUTO_DEPLOY_EXPECTED`. `verify-gate` receives the declaration explicitly and validates it against an exact policy contract. The generated gate proof records the unobservable state and residual risk without using `verified`, `observed off`, or equivalent language.

The current release artifact no longer packages dashboard evidence. Historical approved recovery artifacts may retain their legacy evidence file because their immutable provenance must remain verifiable.

## Preserved controls

G1 does not change source SHA validation, immutable manifests, policy digest, backup evidence, pre/post snapshots, Environment branch restrictions, workflow concurrency, migration allowlists, Edge dependency parity, Security Advisor, Finance OFF, Content Safety P3, remote postcheck, or recovery provenance.

## Provider limitation

Supabase documents the toggle in Dashboard. Its documented GitHub-connections, action-runs, project-config, and branch-config APIs do not expose the current value of **Deploy to production**. Action history can detect unexpected activity but cannot prove the current toggle state. If a reliable official read API is introduced later, the declaration contract should be upgraded to independent observation in a separately reviewed governance change.

## Non-goals

G1 does not mutate Supabase, deploy migrations or Edge Functions, release F2, change Finance, alter P3 or MEDIA-C1, or weaken any control unrelated to the recurring screenshot.
