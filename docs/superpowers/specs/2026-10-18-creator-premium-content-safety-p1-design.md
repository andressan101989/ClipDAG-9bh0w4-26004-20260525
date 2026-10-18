# Creator Premium Content Safety P1 — Design

## Intent

Implement the owner-approved general Creator Premium policy while preserving the
single canonical scanner, private-media authority, publication lifecycle, and
Finance OFF boundary. Explicit adult Premium is excluded.

The policy must distinguish normative approval from operational activation.
The owner has approved the exact allow/review/block matrix in this document,
but the current runtime cannot establish age, consent, contextual text safety,
or contextual transcript safety with sufficient evidence. Therefore P1 is
versioned and deployed fail-closed with activation pending those technical
gates. No missing gate may be converted into an allow decision.

## Canonical policy

Policy identity: `nelyon.creator_premium.general.p1.v1`.

- Allow: courses, tutorials, education, entertainment, dance, humor, sport,
  fashion, kissing and affection, swimwear, non-explicit sensual clothing, and
  non-sexual artistic content when every required modality is complete and no
  severe or ambiguous signal exists.
- Review: contextual/artistic/medical nudity, incidental blood, documentary or
  informational violence, uncertain age, uncertain consent, contradictory
  signals, low confidence, incomplete multimodal coverage, and contextual uses
  of otherwise sensitive words.
- Block: explicit sexual activity, pornography, sexualized explicit genital
  exposure, child sexual exploitation, non-consensual intimate content, sexual
  violence, torture, mutilation, graphic murder or serious assault, and explicit
  promotion of severe harm.
- Explicit adult Premium remains disabled and outside this policy.
- Public previews, teasers, thumbnails, notifications, and discovery inherit
  public-feed constraints.

## Runtime design

The policy is represented by a private, immutable SQL function returning its
version, policy digest, approval state, activation state, matrices, exclusions,
and blockers. It is not a second policy database or a second scanner. Changing
activation requires a new forward-only migration through the existing protected
release workflow.

A second private SQL function evaluates the current canonical scan and returns
exactly one of `allow`, `review`, `block`, `awaiting_policy`, or
`technical_failure`. It consumes only current scan evidence and unresolved
canonical alerts. Phrase-rule signals always route to review because a keyword
cannot establish context. High or critical visual/audio evidence in severe
categories may block publication, but it remains an enforcement gate rather
than legal proof. Any other unresolved signal routes to review. No alert allows
only when the operational policy is enabled and all coverage gates are present.

The existing Creator Premium finalizer consumes that decision. Review and block
remain private and auditable; technical failures fail closed; awaiting policy
preserves the established stable UI code; only allow may proceed to the existing
commercial blocker and publication transition.

## Activation gates

P1 is normatively approved but operationally disabled until all of these are
demonstrated and removed by a later protected migration:

1. contextual text classification is implemented and validated;
2. contextual transcript classification is implemented and validated;
3. age-uncertainty and consent-uncertainty evidence is represented;
4. model confidence or an equivalent bounded uncertainty signal is represented;
5. account quota/headroom is verified for the intended production load; and
6. a private-media end-to-end policy canary is verified without publishing.

The existing deterministic phrase rules remain disabled drafts. They are not
approved or enabled by P1 because their documented benign examples match and a
match is only a contextual signal.

## Security and rollback

- No new public RPC, grant, provider, queue, cron, scanner, client, or financial
  authority is introduced.
- All new functions live in `private`, use an empty `search_path`, and have
  EXECUTE revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- The finalizer keeps its advisory lock, row locks, scan/fingerprint binding,
  generation fences, ownership checks, modality checks, and commercial gates.
- Disable/rollback is forward-only: a later migration replaces the policy
  function with `enabled=false`; history is never deleted.
- Finance stays `false/false/false/0`; no ledger, wallet, escrow, or BDAG path is
  changed.

## Verification

Static contract tests validate the exact matrix, policy digest, excluded +18
scope, private ACLs, decision mapping, and finalizer integration. The disposable
PostgreSQL harness validates installation, fail-closed pending state, RLS/ACL,
and Finance invariants. Existing Premium, Content Safety, Stream, release gate,
and snapshot suites remain green. The canonical release deploys only the single
new migration; no Edge Function is redeployed.
