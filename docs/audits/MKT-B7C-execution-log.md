# MKT-B7C execution log

## Scope and baseline

- Starting SHA: `f891660ac57334226b77320e68b5695e5c7349ca`
- Branch: `codex/mkt-a4b-premium-integration`
- Build: 22
- Starting worktree: clean
- Starting remote migration: `20260811023000`
- Starting remote audit: B7B 23/23, B7A 36/36, B7F 27/27, B7R 32/32; payment, settlement, LIVE, Ads, held escrow, fixture, hook, and security checks healthy.

## Authority audit

- Feed posts and Reels share `public.videos`; `user_id` is the owner. The client classifies video media as Reels and photo/carousel media as Feed posts.
- `videos` has no publication, archive, or moderation visibility column. Deletion is physical and cascades. Reports are review records, not a canonical hidden-content state.
- Existing `videos_select_all` is public. B7C read authorities therefore apply the stricter reusable profile boundary: bidirectional blocks hide tags; private profiles are visible only to the owner or followers.
- Publishing is implemented by `app/(tabs)/upload.tsx`; Cloudflare Stream uses `publish_stream_video_post`, while photo/carousel paths use the existing media RPCs through `FeedContext.addVideo`.
- The unified feed is `app/(tabs)/index.tsx`, rendering `VideoCard` on native and web. There is no separate Reels database table or standalone Reels route.
- Existing Marketplace product detail is `app/product/[id].tsx`. B7B already creates opaque attribution only on explicit Add/Buy and preserves exact-token cart semantics.
- Seller-approved `marketplace_live_affiliate_offers` and `marketplace_resolve_live_affiliate_offer` remain the only commission authority. B7C does not calculate or accept commission economics.

## Blockers and resolutions

### BLOCKER 1

BLOCKER NUMBER: 1  
STAGE: Content-model audit  
ERROR / SQLSTATE: No SQL error; structural mismatch with the proposed separate Feed/Reel FKs.  
SYMPTOM: Feed and Reels are presentation classifications over one `videos` table.  
ROOT CAUSE: The application stores all durable post media in `public.videos` and classifies media by URL/carousel shape.  
CLASSIFICATION: content-model limitation  
SOLUTION: Use one relational `video_id` FK plus a constrained `content_type`, validated against a database implementation of the existing media classifier.  
WHY THIS IS SAFEST: It preserves the canonical content row and deletion cascade without unvalidated generic UUIDs or duplicate content tables.  
FILES/FUNCTIONS CHANGED: B7C migration and content-tag client service.  
PROOF: Disposable Feed and Reel fixture scenarios, foreign-owner rejection, and reconciliation.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: URL-based media classification remains inherited application technical debt.  
STATUS: RESOLVED

### BLOCKER 2

BLOCKER NUMBER: 2  
STAGE: Privacy/moderation audit  
ERROR / SQLSTATE: No SQL error; `videos_select_all` is globally readable and `videos` has no hidden/moderation state.  
SYMPTOM: A raw content lookup cannot by itself enforce profile privacy or blocking, and there is no canonical moderation flag to query.  
ROOT CAUSE: Legacy content RLS predates private-profile and bidirectional-block product surfaces.  
CLASSIFICATION: privacy issue  
SOLUTION: B7C public read authorities enforce the established B7B private-profile/follower and bidirectional-block boundary. Deleted rows disappear through the FK cascade; no nonexistent moderation state is invented.  
WHY THIS IS SAFEST: Product metadata is never revealed more broadly than the established creator-profile shopping surface.  
FILES/FUNCTIONS CHANGED: B7C migration public read functions.  
PROOF: Disposable private-profile, follower, blocked-viewer, and deleted-content scenarios.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: The legacy Feed itself remains globally readable at its existing RLS boundary; B7C does not broaden it and does not redesign Feed privacy.  
STATUS: RESOLVED

### BLOCKER 3

BLOCKER NUMBER: 3  
STAGE: Publish-flow audit  
ERROR / SQLSTATE: No SQL error; media publish and tag-set RPC are separate client calls.  
SYMPTOM: Tags cannot share the media RPC transaction without rewriting mature Stream/photo/carousel publishing authorities.  
ROOT CAUSE: Content creation has multiple specialized authorities and the tag selection exists only at the final client composer stage.  
CLASSIFICATION: publish-flow limitation  
SOLUTION: Persist content first, then immediately call the atomic, idempotent tag-set authority with the returned content ID; on tag failure preserve the valid media row and surface a retryable warning.  
WHY THIS IS SAFEST: It avoids weakening proven upload reliability and guarantees the tag set itself is all-or-nothing and retryable.  
FILES/FUNCTIONS CHANGED: Upload screen, content-tag service, B7C migration.  
PROOF: Untagged and tagged publish source/runtime tests plus idempotency proof.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: A transport interruption can leave published media temporarily untagged; it cannot create partial or unauthorized tags.  
STATUS: RESOLVED

### BLOCKER 4

BLOCKER NUMBER: 4  
STAGE: Disposable reconciliation after tag removal  
ERROR / SQLSTATE: Assertion `reconcile_marketplace_creator_content_tags:invalid_sort_position`, observed count 1.  
SYMPTOM: A removed audit row retained a temporary collision-avoidance position above the active 0–4 range.  
ROOT CAUSE: The first tag-set implementation moved every active row into a temporary position namespace before marking omitted rows removed.  
CLASSIFICATION: migration defect  
SOLUTION: Mark omitted rows removed first, then move only surviving active rows into the temporary namespace before deterministic 0–N reordering.  
WHY THIS IS SAFEST: Historical rows keep their last valid presentation position and active unique-position updates remain collision-free.  
FILES/FUNCTIONS CHANGED: `20260811024000_marketplace_creator_content_product_tags.sql`; `set_my_marketplace_content_product_tags`.  
PROOF: Recreated disposable database; B7C authority, lifecycle, concurrency, finance, and all 28 reconciliation counters passed.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None beyond the bounded five-item ordering contract.  
STATUS: RESOLVED

### BLOCKER 5

BLOCKER NUMBER: 5  
STAGE: Historical freeze/deletion design review  
ERROR / SQLSTATE: No runtime SQL error; destructive provenance risk found before deployment.  
SYMPTOM: `ON DELETE CASCADE` from `videos` would delete a content tag referenced indirectly by frozen B7A attribution history.  
ROOT CAUSE: One nullable FK could not simultaneously enforce active content existence and preserve a durable source identity after content deletion.  
CLASSIFICATION: attribution-integrity issue  
SOLUTION: Store immutable `content_id`, use nullable `video_id` for live relational visibility, and serialize video deletion to tombstone tags (`removed`, `video_id=null`) before the video row is deleted.  
WHY THIS IS SAFEST: Deleted content becomes immediately non-shoppable while legitimate frozen attribution, B7F allocation, settlement, and B7R provenance remain intact.  
FILES/FUNCTIONS CHANGED: B7C migration; deletion lock/tombstone trigger; reconciliation; proof.  
PROOF: Disposable deletion scenario asserted the tag survives with the original content UUID, becomes removed/non-shoppable, and all 28 counters remain zero.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: Legacy `videos` has no independent archive/moderation state; B7C can enforce only deletion plus established profile privacy/block boundaries.  
STATUS: RESOLVED

### BLOCKER 6

BLOCKER NUMBER: 6  
STAGE: Focused Node client tests  
ERROR / SQLSTATE: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` for a TypeScript parameter property under Node strip-only mode.  
SYMPTOM: The B7C test could not import the React Native service solely to exercise the pure media classifier.  
ROOT CAUSE: Node's built-in TypeScript stripping does not support parameter properties used by the service error class.  
CLASSIFICATION: runtime/tooling issue  
SOLUTION: Extract the pure classifier to `marketplaceCreatorContentTagCore.mjs`; the typed service wraps it and Node tests import the portable core.  
WHY THIS IS SAFEST: Runtime database/service behavior is unchanged and the classifier has one testable implementation shared by the app.  
FILES/FUNCTIONS CHANGED: Content-tag core/service and focused tests.  
PROOF: B7B+B7C focused suite passed 22/22.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: None.  
STATUS: RESOLVED

### BLOCKER 7

BLOCKER NUMBER: 7  
STAGE: Read-only linked remote pre-deploy audit bootstrap  
ERROR / SQLSTATE: `EACCES` from the Windows npm/npx cache, followed in the restricted sandbox by `LegacyPlatformAuthRequiredError` while `supabase db dump --linked --dry-run` was acquiring temporary connection variables.  
SYMPTOM: The B7C auditor stopped before opening a database connection or running any reconciliation.  
ROOT CAUSE: A newly created per-auditor npm cache was rejected by the Windows file scanner/lock path during the linked Supabase CLI bootstrap.  
CLASSIFICATION: runtime/tooling issue  
SOLUTION: Reuse the established isolated `onspace-b7a-npm-cache` path already proven by the B7A/B7B linked auditors and run the linked bootstrap in its approved host context, then rerun the read-only audit.  
WHY THIS IS SAFEST: It changes no database authority and uses the repository's existing supported credential bootstrap instead of exposing or persisting credentials.  
FILES/FUNCTIONS CHANGED: `scripts/audit-marketplace-b7c-remote.mjs`.  
PROOF: The rerun result is recorded in the remote pre-deploy section below.  
PRODUCTION ECONOMICS CHANGED: No.  
RESIDUAL RISK: Windows security software can transiently hold CLI cache files; sequential linked audits and the established cache avoid the observed race.  
STATUS: RESOLVED

## Local proof and regression results

The disposable B7C proof passed with real Feed and Reel rows, the five-tag cap, ownership/privacy/blocking, offer replacement, removal, deletion tombstoning, idempotency, two-connection serialization, and 28/28 creator-content-tag reconciliation counters at zero. Its same-store cross-surface order settled exactly as seller 78, platform 10, Creator X 5, Creator Y 7, gross 100; B7R returned exactly 100 to the buyer. The insufficient-beneficiary case returned `money_moved=false` with no partial movement. Persistent B7C fixtures were zero.

Sequential regressions passed for B7B (23/23), B7A (36/36), B7F (27/27), B7R (32/32), held dispute refund and `release_seller`, order lifecycle, shipping, publication, fixture finalization, promotions, analytics, runtime, Ads finance, Ads eligibility, Ads finalization, and Ads delivery/events. The full Node suite passed 619 tests with 0 failures. Focused ESLint reported 0 errors (29 established warnings in touched legacy Feed/card files). TypeScript reported 187 unrelated baseline diagnostics and zero diagnostics from B7C-modified files. The iOS export passed. Build remained 22. No EAS command was run.

## Remote deployment and post-deploy audit

The read-only pre-deploy audit confirmed remote latest migration `20260811023000`, B7C absent, B7B 23/23, B7A 36/36, B7F 27/27, B7R 32/32, payment/settlement/LIVE/Ads reconciliations healthy, held escrow exactly 71 expected and 71 actual, zero B7C fixtures, and no failure hooks.

Production implementation commits were:

- `a5f9ec6dc8c95ebc7f3b4b953167e3c371c603be` - `feat: add marketplace creator content product tagging authority`
- `a49c10689fc9c7dcfe8b3590d53283138dee104b` - `feat: add Feed and Reels product tagging experience`

The linked dry-run contained only `20260811024000_marketplace_creator_content_product_tags.sql`, with no seeds, roles, or historical migrations. That migration deployed successfully.

The final read-only remote audit confirmed latest migration `20260811024000`; B7C 28/28, B7B 23/23, B7A 36/36, B7F 27/27, and B7R 32/32 counters were zero. Payment, settlement, LIVE commission, Ads delivery, eligibility, events, finalization, and finance reconciliations were healthy. Held escrow remained exactly 71 BDAG expected and 71 BDAG actual, with zero difference, shortage, or surplus. The tag table had RLS enabled; authenticated raw mutation was denied; creator management, public read, and buyer wrapper grants were correct; internal B7A and B7F helpers remained private. B7C fixture users were zero and failure/test hooks were absent.

MKT-B7C Feed/Reels Product Tagging is CLOSED. B7D Creator Analytics is unblocked but has not been started.

## B7C-C Concurrency Completion and Publish Tag Retry

### Lock-order audit and completed concurrency proof

The deployed B7C lock order is retained unchanged. Tag-set commands acquire command-key then creator-content; buyer attribution acquires attribution-key then creator-content, product, and resolved offer; content deletion acquires creator-content before tombstoning; seller offer replacement locks the product before its offer namespace. All tested paths converged on the content/product boundary without a cycle, so no SQL correction or new migration was required.

Two independent `pg.Client` connections executed every required race. Same request/same key returned one canonical command and tag set. Different complete sets on the same content serialized to one entire winning set. Remove versus attribution produced either a valid pre-removal attribution or a rejection, never an attribution after `removed_at`. Offer replacement produced only 1200 or 900 BPS according to serialization order; offer revocation allowed only a pre-revocation 900-BPS attribution and rejected subsequent requests. Content deletion either followed a valid attribution or won first and rejected it; the tag always survived as `status=removed`, `video_id=null`, with its immutable `content_id`. Competing reorder/removal-style sets ended with one complete set and exact positions `0..N-1`. No deadlocks, temporary positions, duplicates, mixed sets, or partial states were observed. B7C reconciliation remained 28/28 zero.

### Publish product-tag retry

Media publishing and tag saving remain deliberately separate transactions. The prior warning-only flow discarded the logical tag-save command after the media row was already durable. B7C-C now snapshots a pending command containing the returned content ID, exact `feed`/`reel` type, ordered product IDs, selected-product presentation data, and one UUID idempotency key. Stream uses `published.postId`; photo and carousel use the exact `addVideo` post ID. The retry calls only `set_my_marketplace_content_product_tags` with that same command and never invokes a media upload or publishing authority.

On initial tag-save failure, the normal success/navigation alert is suppressed and a persistent card states `Contenido publicado, productos pendientes`. `Reintentar productos` reuses the same content ID, content type, product set, and idempotency key. Success clears the pending state and selected products; repeated failure retains them. `Continuar sin productos` explicitly clears the pending intent without deleting or republishing the already-valid media. Focused tests cover successful initial save, failed save retention, stable retry identity, no media republish, retry success, repeated failure, explicit discard, and all Stream/photo/carousel call sites. The backend proof separately confirms same-command retry returns the same result and changed products with the same key conflict.

### B7C-C blockers and resolutions

#### BLOCKER 8

BLOCKER NUMBER: 8
STAGE: B7C closure proof audit
ERROR / SQLSTATE: No SQL error; proof coverage gap.
SYMPTOM: Only same-key tag-set and remove-versus-attribution races were executed.
ROOT CAUSE: The primary B7C harness collapsed concurrency into two broad checks.
CLASSIFICATION: concurrency issue
SOLUTION: Add real two-connection competing-set, offer replacement, offer revocation, content deletion, and competing-mutation scenarios with explicit outcomes.
WHY THIS IS SAFEST: It validates the deployed authority before considering any SQL change.
FILES/FUNCTIONS CHANGED: `scripts/prove-marketplace-creator-content-tags.mjs`.
PROOF: All seven named race results returned true, with `noDeadlocks` and `noPartialState` true and reconciliation 28/28 zero.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: PostgreSQL scheduling can select either documented winner; both outcomes are safe and reconciled.
STATUS: RESOLVED

#### BLOCKER 9

BLOCKER NUMBER: 9
STAGE: Upload/publish client audit
ERROR / SQLSTATE: No SQL error; recoverability defect.
SYMPTOM: Successful media followed by a failed tag RPC displayed a warning, cleared selection state, and then displayed a contradictory generic success alert.
ROOT CAUSE: The idempotency key was generated inside each attempt and no pending logical command survived composer reset.
CLASSIFICATION: publish-flow limitation
SOLUTION: Introduce an immutable pending tag-save command plus a shared retry executor and persistent Retry/Continue UI.
WHY THIS IS SAFEST: Retry touches only the already-published content's tag RPC and cannot duplicate Stream, Feed, photo, or carousel media.
FILES/FUNCTIONS CHANGED: `app/(tabs)/upload.tsx`, `services/marketplaceCreatorContentTagPublishRetry.ts`, focused tests.
PROOF: Focused tests preserve content ID/type/products/key, prove zero publisher calls, retain repeated failures, and cover all publishing modes.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: Pending retry is screen-local; navigation is intentionally withheld until Retry or Continue resolves it.
STATUS: RESOLVED

#### BLOCKER 10

BLOCKER NUMBER: 10
STAGE: First disposable B7C-C proof invocation
ERROR / SQLSTATE: `ECONNREFUSED 127.0.0.1:55422`.
SYMPTOM: The proof could not connect immediately after `self-test`.
ROOT CAUSE: Disposable self-test validates a temporary container and tears it down; it is not the persistent proof-create step.
CLASSIFICATION: runtime/tooling issue
SOLUTION: Run the canonical disposable `create` and `verify` commands before the proof.
WHY THIS IS SAFEST: It uses the repository's disposable-only database lifecycle and cannot touch linked production fixtures.
FILES/FUNCTIONS CHANGED: None.
PROOF: Create/verify succeeded and the complete B7C proof passed with zero persistent fixtures.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: None.
STATUS: RESOLVED

### B7C-C regression and release status

B7C passed all original scenarios plus every named concurrency race, exact seller/platform/creator economics of 78/10/5/7 on gross 100, buyer refund 100, insufficient-balance `money_moved=false`, 28/28 counters zero, and zero fixtures. B7B passed 23/23, B7A 36/36, B7F 27/27, and B7R 32/32. Held refund, manual review, `release_seller`, lifecycle, shipping, publication, fixture finalization, promotions, analytics, runtime, and all Ads proofs passed. The full Node suite passed 621 tests with zero failures. Focused ESLint passed with zero errors. TypeScript retained 187 unrelated baseline diagnostics and zero diagnostics in B7C-C files. iOS export passed. Build remained 22. No EAS command was run.

No production SQL or financial formula changed, no migration was created, and no Supabase push/dry-run/deployment was performed for B7C-C. Final read-only remote verification kept latest migration `20260811024000`; B7C 28/28, B7B 23/23, B7A 36/36, B7F 27/27, and B7R 32/32 were zero. Payment, settlement, LIVE, and Ads reconciliations were healthy; held escrow remained 71/71 BDAG; RLS/grants were correct; fixtures and failure hooks were absent.

## B7C-C2 Explicit Server Clear Certainty

### Authoritative discard semantics

The remaining ambiguity was a valid transport-uncertainty sequence: the original non-empty tag-set command could commit in PostgreSQL while its response was lost, after which the previous `Continuar sin productos` action cleared only local React state. The user could therefore explicitly choose to continue without products while the published content remained remotely shoppable.

B7C-C2 makes discard an authoritative second command. Every pending product-tag save now carries two distinct stable UUIDs: the original save idempotency key for the ordered non-empty product set, and a clear idempotency key for the empty set. `Reintentar productos` continues to send the original content ID, content type, ordered product IDs, and save key. `Continuar sin productos` sends the same content ID and type with `productIds=[]` and the distinct clear key through the existing canonical `set_my_marketplace_content_product_tags` authority.

The pending card is dismissed only after the empty-set command is confirmed. A clear failure retains the complete pending state and reports that removal could not be confirmed. If the clear commits but its response is lost, another click retries the same content/type/empty-set/clear-key command and receives the canonical idempotent result. Both actions are disabled while either remote operation is in flight. No Stream, photo, carousel, Feed, or Reel publishing function is called by clear or retry.

The deployed tag-set authority already accepts an empty UUID array, fingerprints it as a distinct request, locks the command key and creator-content namespace, marks the complete active set removed atomically, and supports idempotent replay. Disposable proof established `[P1,P2] -> []`, same-key empty-set replay, changed non-empty request conflict on the clear key, and a real two-connection save-versus-clear race. Both commands serialized without deadlock or partial state; the final state was exactly the last serialized complete command, with valid positions and B7C reconciliation 28/28 zero. No SQL correction or migration was required.

Focused client tests model both uncertainty boundaries. When the original `[P1]` save commits but its response is lost, explicit clear leaves the authoritative model empty. When clear commits but its response is lost, retry reuses the same clear key and confirms the already-empty state. The tests also prove save and clear keys differ, content identity/type are preserved, clear always sends an empty list, failed clear retains pending state and does not claim success, successful clear removes pending state, and the media publisher is never invoked.

### B7C-C2 blockers and resolutions

#### BLOCKER 11

BLOCKER NUMBER: 11
STAGE: Post-publish retry state audit
ERROR / SQLSTATE: No SQL error; remote-certainty defect under a committed-command/lost-response sequence.
SYMPTOM: `Continuar sin productos` cleared only local pending and selected-product state, so remotely committed active tags could survive the user's explicit discard choice.
ROOT CAUSE: The client represented discard as a local UI decision rather than a second canonical tag-set command.
CLASSIFICATION: source-attribution issue
SOLUTION: Execute an explicit empty-set command against the existing published content and clear local state only after confirmed server success.
WHY THIS IS SAFEST: It reuses the single atomic, ownership-checked B7C authority and creates no second tag mutation path.
FILES/FUNCTIONS CHANGED: `services/marketplaceCreatorContentTagPublishRetry.ts`, `app/(tabs)/upload.tsx`, `tests/marketplaceMktB7CContentTags.test.mjs`, `scripts/prove-marketplace-creator-content-tags.mjs`.
PROOF: Transport models cover original-save commit/response loss and clear commit/response loss; disposable proof covers empty-set replay and two-connection save/clear serialization.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: Pending state remains deliberately screen-local, with navigation withheld until Retry Products or Continue Without Products reaches a confirmed result.
STATUS: RESOLVED

#### BLOCKER 12

BLOCKER NUMBER: 12
STAGE: Combined sequential Marketplace regression run
ERROR / SQLSTATE: `22023` from the B7A finalizer when settlement won its documented concurrency race.
SYMPTOM: The first B7A regression invocation sampled the safe settlement-first outcome, while its older harness assertion expected the finalizer-first outcome.
ROOT CAUSE: PostgreSQL scheduling selected the other explicitly supported serialization result; no authority or financial invariant failed.
CLASSIFICATION: runtime/tooling issue
SOLUTION: Preserve production authority unchanged and rerun the B7A proof in isolation, where the complete suite passed and reconciled.
WHY THIS IS SAFEST: It does not weaken the settlement/finalization boundary merely to force one scheduler outcome.
FILES/FUNCTIONS CHANGED: None.
PROOF: Isolated B7A proof passed with 36/36 counters zero; B7F 27/27, B7R 32/32, and all other sequential financial regressions also passed.
PRODUCTION ECONOMICS CHANGED: No.
RESIDUAL RISK: The legacy B7A harness remains scheduling-sensitive when it samples the valid settlement-first branch.
STATUS: RESOLVED

### B7C-C2 validation and remote certainty

The focused B7C client suite passed 16/16. The full Node suite passed 623 tests with zero failures. Focused ESLint passed with zero errors. TypeScript retained 187 unrelated baseline diagnostics and produced zero diagnostics in B7C-C2-modified files. The iOS export passed and Build remained 22. B7C retained exact seller/platform/creator economics of 78/10/5/7 on gross 100, exact buyer refund 100, and insufficient-balance `money_moved=false` with no partial movement. B7C was 28/28 zero, B7B 23/23, B7A 36/36, B7F 27/27, and B7R 32/32. Held refund, manual review, `release_seller`, lifecycle, shipping, publication, fixture finalization, promotions, analytics, runtime, and all Ads proofs passed. Disposable resources were destroyed.

The final read-only linked audit confirmed migration `20260811024000` remains latest. B7C 28/28, B7B 23/23, B7A 36/36, B7F 27/27, B7R 32/32, payment, settlement, LIVE, and all Ads reconciliations were healthy. Held escrow was exactly 71 BDAG expected and 71 BDAG actual. RLS and grants were correct, persistent B7C fixture users were zero, and failure/test hooks were absent.

No historical migration changed, no migration was created, no Supabase dry-run or push was run, no financial formula changed, and no EAS command was run. MKT-B7C-C2 remote-clear hardening is complete; MKT-B7C remains fully closed and B7D is ready but has not been started.
