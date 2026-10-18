# Creator Premium Content Safety P2 — Design

## Intent

Close the seven evidence blockers recorded by P1 without weakening its fail-closed
boundary. P2 adds one policy-context stage to the existing Content Safety worker;
it does not create another scanner, provider, moderation authority, or publication
path. The P1 policy remains disabled while this stage is deployed and observed.
Only a later forward-only activation revision may enable automatic publication,
and only after all seven gates have fresh evidence.

## Existing authority preserved

- `content-safety-scan` remains the only scanner and queue consumer.
- Cloudflare Workers AI remains the only AI provider. The dedicated
  `CLOUDFLARE_AI_TOKEN` Edge secret is used by the worker; the Stream credential
  is never reused for AI.
- Canonical text, transcript, visual, report, generation, ownership, and media
  evidence remains in the existing scan graph.
- `private.creator_premium_content_safety_decision_p1_v1(uuid)` remains the only
  publication decision consumed by the finalizer.
- Finance remains `false/false/false/0`, and explicit adult Premium remains out
  of scope.

## Context evaluation stage

One private evidence table records one immutable policy-context evaluation per
Creator Premium scan, content fingerprint, and policy runtime revision. A
service-role-only claim/complete/fail RPC family exposes bounded work to the
existing worker. Claims are eligible only when the canonical scan is complete,
the private media analysis is present, the current generation/fingerprint is
still bound, and video transcription is complete. Attempts and provider calls
remain bounded to five, with leases, `SKIP LOCKED`, idempotency, and exponential
backoff.

The worker submits a single strict function call for the whole content context:

- the canonical title/description text;
- the canonical transcript or an explicit `no_speech` / `not_applicable` state;
- the already persisted visual analysis summary and findings, bound by analysis
  ID and fingerprint.

No media URL, raw image/video bytes, user identity, signed token, or entitlement
is sent by this new stage. Raw private media remains processed only through the
existing R2/Stream paths.

The strict result contains only bounded enums and codes: `allow`, `review`, or
`block`; exact P1 categories; per-modality coverage; a discrete
`unambiguous`/`ambiguous` uncertainty state; `not_relevant`/`present` age and
consent uncertainty; and bounded rationale codes. It contains no free-form
identity assertion and no numeric or purportedly calibrated confidence score.

## Gate semantics

1. **Contextual text.** The same model contract classifies title and description
   in context. Negation, quotation, education, medical discussion, and ambiguity
   are explicit contractual cases. Isolated words cannot independently allow or
   block.
2. **Contextual transcript.** Transcript text is evaluated in the same context;
   provider-confirmed silence is complete `no_speech`, while missing or failed
   transcription is never eligible.
3. **Age uncertainty.** The result can only say `not_relevant` or `present`. It
   cannot assert adulthood, minority, identity, or age from appearance. Sexual
   context with unresolved age routes to review; explicit child exploitation is
   a severe block signal.
4. **Consent uncertainty.** The result can only say `not_relevant` or `present`.
   Visual appearance can never prove consent. Intimate context without reliable
   consent evidence routes to review; explicit non-consensual intimate content
   or sexual violence is a severe block signal.
5. **Model confidence.** Gemma does not expose a calibrated probability in this
   contract. P2 therefore uses a documented discrete uncertainty contract:
   only a schema-valid, internally consistent, complete, unambiguous result may
   allow. Any contradiction, ambiguity, refusal, truncation, missing modality,
   invalid carrier, or provider error routes to review or technical failure.
6. **Quota/headroom.** Live calls are permitted only after the official
   Cloudflare account usage surface proves daily headroom. Evidence records the
   observation time and displayed neuron use; no purchase or plan change is
   allowed.
7. **Private-media E2E.** Existing authorized QA media must demonstrate the
   chain from private R2/Stream evidence through visual/audio/text persistence,
   policy-context evaluation, the P1 decision, reconciliation, and a still-
   private result before activation.

## Decision and activation

The first protected release adds the evidence runtime while leaving
`enabled=false`, `auto_publish_enabled=false`, and all seven blockers intact.
After the live evidence checkpoint, a second forward-only migration is prepared
only if every gate is demonstrated. That migration versions the operational
policy revision, clears the blockers, replaces the existing P1 decision body to
consume the bound evaluation, and leaves the existing finalizer as the sole
publication transition.

An allow requires current ownership/generation/fingerprint, complete canonical
modalities, a completed bound context evaluation, no ambiguity or uncertainty,
and only P1 allow categories. Review and block stay private. Unknown or stale
evidence fails closed. The activation revision is omitted entirely if any gate
is not demonstrable.

## Verification

- Unit/contract tests cover contextual positive and negative cases, every
  malformed carrier/schema, age/consent limitations, the absence of numeric
  confidence, coverage invariants, and bounded retries.
- Disposable PostgreSQL tests cover claims, locks, idempotency, bindings,
  RLS/ACL, candidate decisions, Finance OFF, and activation fail-close.
- A bounded synthetic provider probe is allowed only after quota headroom is
  observed. Existing QA media is reused; no new upload is created.
- Production releases use only the canonical workflow and exact manifests.

