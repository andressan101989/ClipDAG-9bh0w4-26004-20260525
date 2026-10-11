# Creator Premium Content Safety — F6/F7 Readiness Record

Date: 2026-10-11
Status: `POLICY_AUTHORITY_PENDING`
Production effect: none
Authorized external budget: USD 0

This record separates policy preparation, static contracts, disposable database
integration, real provider component validation, and full private-media provider
E2E. It is not a production activation document and does not amend Nelyon's
Terms, Community Guidelines, privacy policy, or store declarations.

## Canonical architecture

- `private.content_safety_rules`, scans, alerts, visual analyses, and audio
  transcripts remain the single Content Safety authority.
- `private.creator_premium_contents` remains the single Premium publication
  lifecycle authority.
- B1 remains the entitlement authority; B2/B3 remain the private-media
  authorities; B4 remains the only financial authority.
- A creator publication request cannot assign `published`. The server requires
  current text, report, visual, and — for video — audio evidence, current
  fingerprints, eligible account/media, and valid commercial configuration.
- Model and phrase-rule outputs are signals for bounded safety review, not legal
  proof and not an administrative shortcut to publication.

## Candidate policy artifact

The machine-readable candidate is
`docs/creator-premium-content-safety-policy-candidate-v1.json`.

It contains narrow English and Spanish phrase signals for the two canonical
scopes supported by the current database contract: `creator_premium_text` and
`transcript`. Every proposed rule is a disabled draft. No SQL seed, RPC call,
production insert, approval, enablement, or rescan is part of F6.

The candidate deliberately does not use isolated broad words such as "child",
"sex", "violence", or "fraud". Even the narrow phrases have substantial false
positive risk in journalism, education, victim support, prevention, and legal
discussion. A preview plus explicit human policy approval remains mandatory.

The roadmap establishes zero-tolerance product constraints for child sexual
abuse material, minors in sexual content, non-consensual intimate imagery,
sexual exploitation, hidden-camera sexual material, coercion, and illegal
sexual content. It also requires dedicated legal, age, store, payments, and
moderation reviews before any adult/nude/intimate Premium capability launches.
Those constraints do not yet constitute a complete, versioned public Nelyon
Community Guideline or Terms authority. Exact normative definitions, permitted
adult-content boundaries, reporting obligations, evidence retention, regional
law, appeal SLAs, and enforcement levels therefore remain
`POLICY_AUTHORITY_PENDING`.

Apple's App Review Guidelines 1.1/1.2 and Google Play's UGC policy require
filtering, reporting, responses to concerns, blocking, and robust moderation;
their current requirements must be rechecked at activation time. Store policy
is an external distribution constraint, not a substitute for Nelyon's own
approved policy.

## Detection boundaries

### Text and transcript

The canonical engine supports deterministic NFKC-normalized `keyword` and
`phrase` rules only. It does not understand intent, consent, satire, quotation,
newsworthiness, imminence, or legality. The F6 candidate therefore emits
signals only. It does not claim that a non-match makes content safe.

### Visual

The configured provider/model contract is Cloudflare Workers AI with
`@cf/google/gemma-4-26b-a4b-it`, prompt `visual-safety-v1`, strict JSON schema,
and bounded findings. The request disables model thinking and the application
independently validates every key, category, triage level, frame index, and
length. Malformed or contradictory output fails closed.

A generalist visual model cannot establish age, consent, identity, illegality,
or whether intimate material was authorized. The prompt intentionally forbids
age and identity inference. It cannot guarantee CSAM detection and must not be
described as doing so. Specialized legal/safety controls, trained reviewers,
reporting, and escalation remain required for grave categories.

### Audio

The configured transcription contract is Cloudflare Workers AI
`@cf/openai/whisper-large-v3-turbo`. Silence or an empty transcript is not proof
of safety. A Premium video requires a completed canonical audio modality and an
approved, enabled transcript policy before publication. Provider error,
timeout, malformed output, missing audio evidence, or missing policy fails
closed.

F6 adds a private Stream audio-download grant using the same B3 RS256 signing
authority, a 300-second TTL, and the provider-required `downloadable: true`
claim. Normal consumer playback grants remain non-downloadable. The signed M4A
URL exists only in worker memory and is not returned to a client, logged, or
persisted. Cleanup continues through the existing Stream audio cleanup path.

## Private-media controls

### R2 originals

The worker consumes the canonical private B2 asset selected by the database
snapshot/claim contract. It requires a supported image MIME, ready private
media identity, and bounded bytes (25,000,000 bytes for a Premium original).
It retrieves bytes server-side from R2, compares the returned Content-Type,
uses a data URI only in the provider request, and creates no public URL or
inspection copy. Foreign, deleted, incomplete, oversized, or MIME-mismatched
assets fail closed.

### Stream originals

B3 requires `requireSignedURLs=true` and persists no playback URL. Visual frame
inspection uses the same private signing key with a 300-second token and accepts
only the canonical customer hostname, signed-token path, JPEG response, three
allowed query keys, bounded timestamps, bounded redirects, and a 2 MiB frame.
Video audio uses a distinct downloadable token scoped to the same UID and TTL;
consumer grants never receive the `downloadable` claim. Provider UIDs and tokens
remain server-side.

The worker's required configuration names are `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_AI_TOKEN`, `CLOUDFLARE_STREAM_TOKEN`, `STREAM_CUSTOMER_CODE`,
`STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_KEY_JWK_B64`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `R2_PRIVATE_BUCKET`, plus the normal Supabase service
and dispatch values. F6 validates these names and their call boundaries in
source; it does not read, print, rotate, or assert the values. A real component
probe is still needed to prove current account permissions, model entitlement,
quota, and signing-key alignment.

## Lifecycle and failure policy

Publication remains fail-closed for provider unavailability, invalid JSON,
missing image, missing required audio, expired or invalid token, timeout,
missing required policy, stale fingerprint, restricted account, active alert,
invalid media, and invalid commercial configuration.

The automatic paths remain:

- `draft -> pending_review -> published` after complete current evidence;
- `pending_review -> commercial_pending -> published` when safety passes before
  a mapped plan becomes active;
- active signals route the exact content to `quarantined`/restricted handling;
- removed content cannot be republished by a late worker;
- an exact `no_violation` false-positive resolution never becomes a creator-wide
  allowlist and is invalidated by new evidence, original, fingerprint, detector,
  or policy facts.

## Readiness levels

1. `STATIC_CONTRACT_PASS` — source contracts and deterministic tests pass. This
   proves validation logic, authorization boundaries, and fail-closed behavior;
   it does not prove an external provider response.
2. `DISPOSABLE_E2E_PASS` — the real PostgreSQL migration chain and B7 fixture
   pass with isolated data and simulated provider evidence. B7-F5 established
   this level and F6 reconfirmed it. It does not prove R2/Stream/Workers AI
   interoperability.
3. `REAL_PROVIDER_COMPONENT_PASS` — pending. It requires an explicitly
   authorized benign synthetic visual probe and audio probe with real provider
   responses, captured latency/usage, no user media, and confirmed zero or
   approved cost.
4. `PREMIUM_PROVIDER_E2E_PASS` — pending. It requires a separately authorized
   non-production environment, synthetic private R2 image and Stream video,
   real signing/media retrieval/AI/transcription/reconciliation, cleanup proof,
   and no production data or rules.

Real provider validation was not executed in F6 because the authorized external
budget is USD 0 and no account-specific non-billable allowance was proven before
the call. Mocks and local cryptographic tests are not reported as provider PASS.

## Capacity, latency, retries, and cost

One worker invocation currently claims at most 25 text scans, 10 transcript
evaluations, one audio scan, and one visual scan. A Premium video samples five
frames. Because a single invocation advances one frame, five frames can consume
five provider calls and, under the one-minute scheduled dispatch alone, roughly
five worker cycles. With no competing backlog this implies nominal scheduled
ceilings of about 60 images/hour, 12 five-frame videos/hour, 60 audio jobs/hour,
600 transcript evaluations/hour, and 1,500 text scans/hour. Immediate wakes can
reduce latency but do not change the per-claim safeguards; concurrent workers
serialize claims with database locks.

The five-call visual budget is intentionally fail-closed. A five-frame video has
no spare paid retry after all five provider calls are consumed. A provider error
that counts as a call can prevent completion rather than silently reduce frame
coverage. Raising this budget would increase cost and requires separate owner
approval plus measured failure rates.

Current public Cloudflare pricing checked on 2026-10-11:

- Gemma 4 26B A4B: USD 0.10 per million input tokens and USD 0.30 per million
  output tokens. Exact image-token accounting was not observed, so an exact
  per-frame amount cannot be claimed before real usage telemetry. With the
  current 1,200-output-token cap, the maximum output-token component is USD
  0.00036/frame or USD 0.00180/five frames; input/image cost is additional.
- Whisper large-v3-turbo: USD 0.000513/audio minute, so a 60-second Premium cap
  has an ASR list-price component of at most USD 0.000513 per attempt.
- Workers AI includes 10,000 neurons/day before overage and lists USD 0.011 per
  1,000 neurons above the allowance on paid plans. Account usage must be checked
  before calling; a nominal free allocation is not an F6 spending authorization.
- Stream lists media transformations at USD 0.50/1,000 operations with 5,000
  monthly operations included. Five frames are five potential transformations;
  60 seconds of extracted audio are 60 potential operations. Billing
  classification for the exact existing Stream endpoints must be confirmed in
  account telemetry, so these figures are planning bounds, not an invoice.

The prior production worker request latency is not provider latency because no
Premium provider E2E was run and no production rules are active. Real component
p50/p95, retry rate, backlog age, neurons/tokens, Stream operations, and cleanup
success must be captured during the separately authorized synthetic canary.

## B7-F7 synthetic provider canary

F7 adds one local runner, `scripts/creator-premium-provider-canary.mjs`. It
reuses the canonical visual probe, Whisper response normalizer, policy artifact,
and models the required private-media and publication contracts without calling
those runtime authorities. It is not a second worker, scanner, media service,
publication state machine, or policy store.

The canonical local command is:

```powershell
npm run test:safety:premium-canary
```

With no arguments it always selects `DRY_RUN`, keeps network disabled, performs
no remote upload or inference, spends USD 0, and reports `DRY_RUN_PASS`; the
aggregate checkpoint is recorded as `CANARY_DRY_RUN_PASS`
after the package command validates the local synthetic image, strict visual
schema, Spanish and English transcript shapes, silence handling, candidate
fingerprints, and bounded operation inventory. The separately invoked F7 test
suite validates the built-in deterministic simulator, timeout, budget, cleanup,
and redaction. No caller-provided executor is accepted.

The expected F7 readiness split is:

- `POLICY_PREPARED`: candidate definitions and review fingerprints exist;
- `CANARY_DRY_RUN_PASS`: local contracts and deterministic simulations pass;
- `REAL_PROVIDER_COMPONENT_PENDING`: no real Workers AI call occurred;
- `PREMIUM_PRIVATE_MEDIA_E2E_PENDING`: no R2 or Stream asset was uploaded;
- `PRODUCTION_ACTIVATION_NOT_AUTHORIZED`: no rule, migration, Edge function,
  finance switch, or production resource changed.

The runner has three visibly distinct modes: `DRY_RUN`,
`REAL_PROVIDER_COMPONENT`, and `PRIVATE_MEDIA_E2E`. A real mode fails with
`EXTERNAL_AUTHORIZATION_REQUIRED` before any provider adapter could run unless it
receives a separate owner-approved authorization document. Environment
variables or free quota alone are never authorization. The document must bind
an owner permission identifier, exact mode and scopes, named non-production
Supabase and Cloudflare environments, fresh quota and pricing checks, positive
USD cap, expiry, serial execution, exact scopes and operation/byte/time
limits, structured cleanup controls, and the complete required STOP-condition
set. It is also bound to the normalized runner artifact, exact
canary-plan fingerprint, exact policy-package fingerprint, and a fresh
owner-reviewed worst-case cost estimate that is no lower than the known subtotal
and fits under the authorized cap. The internal simulator can produce only a
`SIMULATED_*_PASS`; it cannot open a provider connection or produce a
real-provider status.

F7 deliberately ships no self-attesting real-provider adapter. A caller object
is rejected and cannot label itself canonical, perform hidden network work, or
obtain `REAL_PROVIDER_COMPONENT_PASS` or
`PREMIUM_PRIVATE_MEDIA_E2E_PASS`; that attempt fails with
`CALLER_SUPPLIED_EXECUTOR_FORBIDDEN`. Without the internal simulator explicitly
selected, external modes fail with `REAL_PROVIDER_EXECUTOR_NOT_IMPLEMENTED`
before any operation. The future
adapter must independently verify the authorized non-production account and
project, use the exact bound plan/policy/runner fingerprints, validate canonical
provider responses and allowlisted receipts, enforce one deadline across
operations and cleanup, report measured usage, and prove cleanup. Until that
separately reviewed adapter exists, both real statuses remain `PENDING` even if
all deterministic simulations pass.

### Synthetic fixtures and private-media path

- Image: the existing deterministic 556-byte PNG with a red square and blue
  circle, no people or personal data. Its byte hash is verified locally.
- Video: a six-second MP4 descriptor with five timestamps (0, 1500, 3000, 4500,
  and 5999 ms), simple shapes, no identifiable person, and benign audio. The
  actual MP4 must be generated locally only after external authorization; F7
  commits no binary video and uploads nothing.
- Audio: Spanish and English benign transcript-contract fixtures plus the
  existing deterministic PCM WAV silence fixture. These prove parsing,
  language, segments, timecodes, and silence behavior locally; they do not prove
  acoustic recognition by Whisper.

The future private-media run is intentionally serial. It may create at most one
private R2 object and one private Stream video, must set
`requireSignedURLs=true`, samples exactly five signed frames, uses the distinct
300-second `downloadable:true` audio token, keeps ordinary playback
non-downloadable, performs one canonical reconciliation, and then inventories
and removes the exact R2 object, Stream video, and temporary audio derivative.
Any residual resource makes the canary fail. Public-video audio continues to use
the historical public route and never invokes the Premium signer.

### Operation and cost envelope

The proposed full canary hard limits are: concurrency 1, retries 0, 15 minutes,
25,000,000 transmitted bytes, one R2 upload, one Stream upload, 11 Stream
transformation operations, 11 AI calls, and at most two persistent remote assets
before mandatory cleanup. The full plan has 20 operations: 19 expected provider
network operations plus one PostgreSQL-disposable reconciliation. The 11 AI
calls are seven visual calls (one component probe, one R2 original, and five
Stream frames) and four audio calls (Spanish, English, silence, and the
private-video transcript). The 11 Stream transformations are five still frames
plus six seconds of audio extraction.

At the public rates checked on 2026-10-11, the known variable portion is USD
0.010072: up to USD 0.002520 for seven visual responses at the current
1,200-output-token cap, USD 0.002052 for four conservatively rounded Whisper
minutes, and USD 0.005500 for 11 Stream transformations. Visual input/image
units, account-specific free allocation, R2 operations/storage, Stream storage
and delivery, and billing rounding are not fully represented by that subtotal.
The proposed owner cap is therefore USD 0.05, subject to a fresh account quote
and quota check immediately before execution. Because the subtotal is
incomplete, a future authorization must carry a fresh conservative worst-case
estimate covering every planned operation; the runner rejects it when that
estimate is below the known subtotal or exceeds the owner cap. The currently
authorized budget remains USD 0, so every external call stays disabled.

Cloudflare currently lists 10,000 Workers AI neurons/day as the free allocation
and USD 0.011/1,000 neurons above it on paid Workers plans; default task limits
include 720 ASR requests/minute and 300 text-generation requests/minute unless a
model-specific paid limit applies. Stream transformations list USD 0.50/1,000
monthly unique URL transformations with 5,000 included; a still frame counts as
one and extracted audio counts once per output second. R2 Standard lists USD
4.50/million Class A operations and USD 0.36/million Class B operations, with
one million and ten million respective monthly operations included. These
published allowances do not authorize consumption and must be rechecked for the
specific account and billing plan.

### Policy approval package and fingerprints

The existing candidate JSON remains the only policy catalog. F7 adds
`candidate_fingerprint_sha256` to every draft definition using the documented
`nelyon.creator_premium_candidate_rule.sha256-canonical-json.v1` contract. The
hash covers all reviewable rule fields, an NFKC/lowercase/collapsed-space
pattern, and sorted scopes. It changes when an operative or review field
changes.

The candidate hash is not the canonical database governance fingerprint. The
database fingerprint also includes the UUID and version assigned only when the
canonical audited creation RPC runs. Its status is therefore explicitly
`PENDING_RULE_CREATION_AND_PREVIEW`; after authorized non-production creation,
the exact preview fingerprint must be captured and compared before approval or
enablement. This prevents F7 from inventing a production rule identity.

All 12 candidates remain `draft`, disabled, bilingual signals with high benign
false-positive risk and a recommendation of `REVIEW`, not automatic approval.
Matching phrases in journalism, education, victim support, prevention, fiction,
or legal discussion still route to contextual handling; they are not proof of a
violation. A non-match does not prove safety.

### Owner decisions still required

The owner, with legal/privacy/youth-safety/store/payment review where
appropriate, must expressly decide:

1. whether any adult nudity is permitted and its exact boundaries;
2. which sexual content is permitted, restricted, or prohibited;
3. age assurance and the protections for minors;
4. consent evidence and handling of intimate imagery;
5. report intake, response targets, and removal standards;
6. appeal eligibility and decision authority;
7. maximum review time for restricted exceptions;
8. on-call and final safety roles;
9. evidence, transcript, audit, and provider-data retention;
10. Apple age rating, UGC filtering/reporting/blocking, and purchase treatment;
11. Google Play UGC, incidental-sexual-content, age-screening, and billing
    compliance;
12. payment-provider eligibility plus incident escalation and mandatory
    reporting responsibilities.

Apple App Review Guidelines 1.2/1.2.1 require UGC moderation, reporting,
blocking, contact information, creator-content disclosures, and age handling;
Guideline 3.1.1 can apply to paid digital content. The Google Play User
Generated Content policy requires terms, robust ongoing moderation, in-app
reporting/blocking, action on complaints, safeguards against monetized abuse,
and additional controls for incidental sexual content; Google Play Billing
generally applies to in-app digital content and subscriptions. These are
activation dependencies, not legal advice and not authority for Codex to approve
the candidate rules.

### Observability, rollback and STOP

A future authorized run must record only safe metadata: authorization ID, mode,
operation kind, model, request count, duration, retry count, provider request
ID, neurons/tokens when supplied, calculated cost, cleanup result, and aggregate
error code. Tokens, service credentials, signed URLs, object keys, media bytes,
private payloads, and sensitive account identifiers are redacted.

For the first real canary, every provider, quota, model, signature, timeout,
unexpected-cost, stale-evidence, reconciliation, or cleanup error is a STOP; no
best-effort PASS is allowed. Required observations are per-operation latency,
end-to-end latency, error/retry rate, exact AI and transformation usage, queue
age, publication transition, residual resources, and whether any sensitive
locator reached output. Production SLOs and sustained backlog thresholds remain
an owner/operator decision after the canary supplies real measurements.

Rollback and STOP are bounded to resources created under the authorization ID:
stop issuing operations, keep content private, reject reconciliation, delete the
exact synthetic R2 object and Stream video, verify zero residual derivatives,
preserve sanitized receipts, and revoke/expire the temporary canary credential
outside this code workflow. Future rule rollback uses the existing audited rule
disable/retire governance; it does not delete history or create an alternate
policy authority. No cleanup may target user resources or production by prefix.

## Activation gates

Before any future production activation, all of the following remain mandatory:

1. owner approval of exact normative policy text and every rule fingerprint;
2. legal, privacy, youth-safety, Apple, Google Play, and payments review;
3. controlled preview with benign counterexamples and documented false-positive
   acceptance criteria;
4. `REAL_PROVIDER_COMPONENT_PASS` and `PREMIUM_PRIVATE_MEDIA_E2E_PASS` in an
   authorized non-production environment;
5. account-specific quotas, budget cap, alerting, backlog SLO, reviewer staffing,
   appeal SLA, incident response, and rollback ownership;
6. staged rule approval and enablement through existing audited governance RPCs;
7. post-activation canary verification that no private locator, token, original,
   or sensitive provider payload reaches logs, clients, analytics, or reports.

No production rule was created, approved, enabled, or changed by F6/F7. No
production scan, media upload, provider inference, migration, Edge deployment,
financial operation, or policy activation was performed.

## Source register checked for F6/F7

- Nelyon canonical roadmap: `docs/roadmap/NELYON_MASTER_ROADMAP.md`, section
  "Premium Content Safety / Store Compliance".
- [Cloudflare Workers AI: Gemma 4 26B A4B](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)
- [Cloudflare Workers AI: Whisper large-v3-turbo](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Cloudflare Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
- [Cloudflare Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)
- [Cloudflare Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)
- [Cloudflare Stream signed URLs](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/)
- [Cloudflare Stream audio downloads](https://developers.cloudflare.com/stream/viewing-videos/download-videos/)
- [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play User Generated Content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
