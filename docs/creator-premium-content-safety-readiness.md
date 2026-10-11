# Creator Premium Content Safety — F6 Readiness Record

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

## Activation gates

Before any future production activation, all of the following remain mandatory:

1. owner approval of exact normative policy text and every rule fingerprint;
2. legal, privacy, youth-safety, Apple, Google Play, and payments review;
3. controlled preview with benign counterexamples and documented false-positive
   acceptance criteria;
4. `REAL_PROVIDER_COMPONENT_PASS` and `PREMIUM_PROVIDER_E2E_PASS` in an
   authorized non-production environment;
5. account-specific quotas, budget cap, alerting, backlog SLO, reviewer staffing,
   appeal SLA, incident response, and rollback ownership;
6. staged rule approval and enablement through existing audited governance RPCs;
7. post-activation canary verification that no private locator, token, original,
   or sensitive provider payload reaches logs, clients, analytics, or reports.

No production rule was created, approved, enabled, or changed by F6. No
production scan, media upload, provider inference, migration, Edge deployment,
financial operation, or policy activation was performed.

## Source register checked for F6

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
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play User Generated Content policy](https://support.google.com/googleplay/android-developer/answer/9876937)
