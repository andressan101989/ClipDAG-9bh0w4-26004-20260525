# NELYON MASTER ROADMAP

Version: 1.0

Canonical roadmap authority for the Nelyon project.

Initial canonical base:

`3a29a8bc3042d4cd7c299b6f3ac018c543dcd340`

Initial roadmap date:

2026-10-06

## 1. AUTHORITY

This file is the single canonical roadmap for Nelyon.

It records:

- completed systems;
- partially completed systems;
- pending product macros;
- external blockers;
- architectural constraints;
- execution priority;
- future product requirements.

No parallel roadmap should be created.

When priorities, requirements or module status change,
this same file must be updated.

The project owner is the authority for:

- adding roadmap scope;
- removing roadmap scope;
- changing priorities;
- approving phase closure.

ChatGPT is the roadmap architect/auditor.

ChatGPT must consult this file when recovering project state.

Codex is the implementation executor.

Codex must not independently modify roadmap scope.

## 2. SOURCE-OF-TRUTH PRIORITY

When this roadmap conflicts with runtime state,
the following precedence applies:

1. verified production;
2. remote Git branch/SHA;
3. verifiable Codex evidence;
4. latest approved checkpoint;
5. this roadmap status;
6. recent chat;
7. older memory.

The roadmap describes intended product direction.

Git/production determine factual implementation state.

## 3. STATUS DEFINITIONS

### CLOSED / FROZEN

Implemented, audited and approved.
Do not rebuild without a newly proven reason.

### ADVANCED / OPEN

Large portion implemented,
but one or more meaningful closure gates remain.

### PARTIAL

Architecture or functionality exists,
but macro is not complete.

### PENDING

Not yet implemented as a complete macro.

### EXTERNAL BLOCKER

Blocked primarily by an external dependency,
vendor, account, license or credential.

### DEFERRED

Intentionally postponed by the owner.

### NEXT PLANNED

Next macro in the working roadmap.

Implementation still requires explicit owner authorization.

## 4. PERMANENT ARCHITECTURE RULES

Do not create duplicate product authorities.

Do not create:

- duplicate feeds;
- duplicate ranking engines;
- duplicate wallet systems;
- duplicate ledgers;
- duplicate escrow systems;
- parallel Creator Content systems;
- parallel Stories systems;
- parallel Chat systems;
- parallel media authorities;
- duplicate RPCs that perform the same operation;
- orphan services/components.

Reuse existing canonical architecture whenever valid.

Financial logic remains server-side.

Financial operations must remain:

- atomic;
- idempotent;
- auditable;
- balanced;
- server-authoritative.

Do not put financial authority into UI.

Do not delete historical migrations.

Do not delete apparently old production code without proving
that it is genuinely unreachable and unnecessary.

## 5. COMPLETED / FROZEN FOUNDATIONS

### Marketplace

STATUS:

CLOSED / FROZEN for the major Marketplace implementation.

Existing Marketplace architecture includes:

- buyer commerce;
- seller operations;
- checkout;
- inventory;
- shipping;
- returns;
- refunds;
- settlement;
- creator commerce;
- Marketplace advertising;
- admin/operations infrastructure.

Do not rebuild Marketplace from scratch.

### WalletConnect / Reown

STATUS:

CLOSED.

Do not list as a pending macro.

### Cloudflare R2

STATUS:

CLOSED as infrastructure foundation.

Do not rebuild.

### Cloudflare Stream

STATUS:

CLOSED as infrastructure foundation.

Do not rebuild.

### ALGO-6

STATUS:

CLOSED / APPROVED / IN MAIN.

Final canonical main SHA at roadmap creation:

`3a29a8bc3042d4cd7c299b6f3ac018c543dcd340`

ALGO-6 includes:

- L1 through L5 adaptive ranking;
- onboarding cold start;
- semantic interests;
- language preference;
- region preference;
- creator seeding;
- behavioral confidence;
- explicit seed decay;
- observation dataset foundation;
- training readiness;
- future model pipeline;
- Ads personalization bridge.

Physical proof confirmed automatic adaptation.

L6 statistical ML model remains intentionally:

- not trained;
- not deployed;
- not active.

This is intentional until real dataset gates are satisfied.

Do not train or activate L6 merely because this roadmap exists.

## 6. CURRENT PARTIAL / ADVANCED SYSTEMS

### LIVE Battles 1v1

STATUS:

ADVANCED / OPEN.

Substantial LIVE Battle implementation exists.

Do NOT restart from LB1.

Existing work includes:

- invitations;
- battle lifecycle;
- server time;
- timer;
- scores;
- gifts;
- winner lifecycle;
- realtime synchronization;
- rematch;
- spectator UX;
- Media Relay work;
- Agora integration;
- recovery/reconciliation.

Remaining macro requirement:

FINAL PHYSICAL CLOSURE.

Must validate on real devices:

- host A video;
- host B video;
- cross-host audio;
- Media Relay;
- reconnect;
- background/foreground;
- timer;
- scores;
- gifts;
- winner;
- rematch;
- spectator experience;
- long-running battle stability.

Banuba Premium AR Gifts are a later extension
and are specified separately below.

### Chat V2

STATUS:

ADVANCED / OPEN.

CHAT-V2 A through G code integration is substantially complete.

Architecture includes:

- direct messages;
- group conversations;
- receipts;
- voice messages;
- direct calls;
- group calls;
- push;
- unified canonical message authority.

Remaining:

final multidispositivo / physical validation and any
strictly proven corrective work.

### Stories V2

STATUS:

PARTIAL.

Core Stories work exists.

Stories must NOT be marked fully closed until
Interactive Stories requirements below are implemented
and physically validated.

### Superuser Global Admin

STATUS:

PARTIAL / OPEN.

Admin capability exists.

Full Superuser global-admin macro must be
audited against the intended total product authority
before being declared closed.

### Business Ads

STATUS:

ADVANCED / OPEN.

Ads V2/V4 architecture is highly developed.

Existing areas include:

- Business Web campaign creation;
- Admin approval;
- production controls;
- campaign lifecycle;
- targeting;
- analytics/readiness;
- social-feed placement;
- personalization targeting bridge.

Do not create a parallel Ads system.

Any remaining production closure,
billing provider integration and real V4 audience rollout
must reuse the existing Ads architecture.

### Seller Center / Business Web

STATUS:

ADVANCED / OPEN.

Significant Seller/Business Web functionality exists.

Do not rebuild from scratch.

Remaining closure must be determined by audit and
physical/browser validation.

### Stripe

STATUS:

EXTERNAL BLOCKER / OPEN.

Stripe is intended as an external USD/card payment rail.

Nelyon ledger remains the internal BDAG authority.

No second wallet.

No browser service_role.

Stripe work depends on:

- real Stripe account;
- production credentials;
- webhook configuration;
- livemode readiness;
- final refund/dispute hardening;
- real production validation.

## 7. CURRENT WORKING EXECUTION ROADMAP

This is the current owner-defined working order.

The owner may reorder it by updating this file.

No macro begins automatically.

### ROADMAP 1 — CREATOR PREMIUM / EXCLUSIVE CONTENT

STATUS:

NEXT PLANNED / PARTIAL FOUNDATION EXISTS.

The creator must have a dedicated premium/exclusive
content experience.

Existing creator-exclusive architecture must be audited
and reused rather than duplicated.

Required product capabilities:

- creator premium section;
- exclusive photos;
- exclusive videos;
- optional creator subscription;
- individual content purchase where product design requires it;
- entitlement / ownership;
- purchased-content library;
- creator earnings;
- premium previews that NEVER expose the original protected asset;
- locked states;
- subscription states;
- expired/revoked access states;
- refund/reversal compatibility;
- creator analytics;
- moderation/reporting.

The existing economic authorities for:

- content purchase;
- subscription;
- Premium DM;

must be audited and reused where appropriate.

No parallel wallet or premium-content economy.

#### PREMIUM CONTENT PRIVACY / ANTI-EXFILTRATION

Premium paid media must remain isolated from normal public media.

Premium assets must NOT use permanent public URLs.

Required direction:

- private media storage;
- server-authorized access;
- entitlement check before playback;
- short-lived signed playback/access;
- no download button;
- no save-to-camera-roll action;
- no external share action;
- no repost;
- no public deep link exposing protected asset;
- no WhatsApp share of premium asset;
- no public Open Graph image containing protected content;
- no public CDN URL that remains reusable indefinitely;
- no AirPlay/casting for protected content unless explicitly approved;
- no indexing as ordinary public Feed content.

If a creator wants a public teaser,
the teaser must be a separate approved public asset.

The premium original remains private.

#### SCREENSHOT / SCREEN-RECORDING PROTECTION

Goal:

maximum technically supported anti-capture protection.

Android:

evaluate/use the official secure-window mechanisms
such as FLAG_SECURE on protected premium surfaces,
subject to physical validation.

iOS:

do NOT falsely claim that every screenshot can be
universally prevented.

Use officially supported capture-state detection
and protective behavior.

When capture/recording/mirroring is detected,
protected playback should be paused, hidden or obscured
according to the final platform-safe architecture.

Evaluate protected video delivery such as FairPlay
where technically/economically appropriate.

For still images where absolute OS-level prevention
cannot be guaranteed, use defense in depth.

Defense in depth may include:

- viewer-specific visible watermark;
- account identifier or pseudonymous viewer marker;
- timestamp/session watermark;
- protected renderer;
- encrypted/ephemeral cache;
- cache purge;
- app-switcher privacy cover;
- background blur/obscuration.

Do not market or document absolute screenshot prevention
unless it has been technically proven for that platform/content type.

#### PREMIUM CONTENT SAFETY / STORE COMPLIANCE

This roadmap does NOT automatically authorize
pornographic or sexually explicit monetized content.

Before launching any adult/nude/intimate premium capability:

perform a dedicated:

- Apple App Store policy audit;
- Google Play policy audit;
- legal review;
- age-gating review;
- payments/provider review;
- moderation review.

Mandatory zero-tolerance categories include:

- CSAM;
- minors in sexual content;
- non-consensual intimate imagery;
- sexual exploitation;
- hidden-camera sexual material;
- coercive content;
- illegal sexual content.

Require:

- uploader rights/consent;
- reporting;
- blocking;
- takedown workflow;
- moderation;
- evidence retention where legally appropriate;
- age controls.

If App Store / Google Play policies prohibit
the intended monetized-content model,
STOP before implementation/release and redesign
the product distribution model legally.

Do not hide this blocker.

### ROADMAP 2 — BANUBA / CREATOR STUDIO V2

STATUS:

PENDING / EXTERNAL VENDOR DEPENDENCY.

Current DeepAR / creator tooling remains in place
until Banuba passes compatibility and physical testing.

Do NOT remove DeepAR early.

#### VENDOR / POC GATE

Before production migration:

- obtain Banuba commercial contact;
- trial/client token;
- written compatibility confirmation where possible;
- pricing;
- license scope;
- module availability.

Run an isolated compatibility POC.

Current technical areas requiring proof include:

- Expo;
- React Native;
- New Architecture;
- Fabric;
- Hermes;
- EAS Build;
- iOS;
- Android;
- camera ownership;
- audio session ownership;
- Agora coexistence;
- GPU/memory;
- binary size;
- physical-device stability.

#### CREATOR STUDIO REQUIRED CAPABILITIES

Target:

- camera;
- photo;
- video;
- Face AR;
- filters;
- beauty;
- effects;
- templates;
- transitions;
- text;
- stickers;
- GIF overlays;
- picture-in-picture if licensed;
- captions;
- AI captions;
- AI editing where licensed;
- trim;
- cut;
- merge;
- timeline;
- speed;
- audio controls;
- music;
- volume mix;
- export;
- thumbnails/covers.

#### MUSIC

Current simple music-preview behavior is NOT
the target final implementation.

Final Creator Studio music must support:

- actual licensed track authority;
- music_track_id;
- provider;
- attribution;
- license metadata;
- music_start_ms;
- music_end_ms;
- music volume;
- original audio volume;
- preview;
- final render/export;
- synchronization.

Do NOT assume that access to a music preview
means Nelyon has redistribution rights.

Licensing is a separate release gate.

#### BANUBA CUTOVER

Only after successful physical validation:

- migrate approved functionality;
- validate production export;
- validate camera release;
- validate Agora after Banuba;
- validate memory/GPU;
- validate 20+ repeated editor cycles;
- remove obsolete DeepAR integration only when proven safe;
- remove orphan legacy editor code after proof.

No big-bang blind replacement.

### ROADMAP 3 — LIVE BATTLES FINAL + BANUBA PREMIUM AR GIFTS

STATUS:

BATTLE BASE ADVANCED.
BANUBA GIFT EFFECTS PENDING.

First close existing LIVE Battles physically.

Then add Banuba premium gift effects.

#### PREMIUM AR GIFTS

Premium LIVE/Battle gifts must not be limited
to static image overlays.

Target experience similar in quality to modern
LIVE social platforms:

Example:

viewer sends crown gift

→ canonical gift purchase succeeds

→ canonical gift event is emitted

→ Banuba AR crown appears on the receiving host

Possible effects:

- crown;
- hat;
- glasses;
- mask;
- fire;
- makeup;
- animated face effect;
- celebration effect;
- other approved AR rewards.

Financial authority remains the existing gift economy.

Banuba is VISUAL ONLY.

Never:

- charge through Banuba;
- calculate gift value in UI;
- duplicate gift transactions;
- reverse valid financial settlement merely because
  a visual effect failed.

Required architecture:

canonical confirmed gift
→ effect mapping
→ synchronized visual event
→ recipient host AR effect
→ spectators see synchronized result where technically supported.

Need:

- gift_id → effect_id mapping;
- duration;
- queue;
- cooldown;
- concurrency rules;
- fallback;
- lifecycle cleanup;
- disconnect recovery;
- abuse limits;
- performance limits.

Visual failure must fail safely without financial duplication.

### ROADMAP 4 — STORIES V2 — INTERACTIVE STORIES

STATUS:

PENDING ON TOP OF EXISTING STORIES FOUNDATION.

Required interactive stickers:

- A/B poll;
- multi-option poll;
- reaction slider;
- "how much do you like this?" slider;
- quiz;
- optional correct answer;
- question box;
- quick reactions;
- results;
- percentages;
- realtime updates where appropriate.

Interactive elements must support:

- move;
- scale;
- position;
- persistent layout;
- responsive rendering;
- accessibility.

Voting/response authority must be server-side.

Prevent:

- duplicate votes where contract is single-vote;
- unauthorized results;
- client-authoritative totals.

Reuse this interaction architecture later for posts
where appropriate.

Do not create a separate poll engine for each surface.

### ROADMAP 5 — SHARE / DEEP LINKS / RICH PREVIEW / REPOST

STATUS:

PENDING.

Public Feed content must support professional sharing.

#### EXTERNAL SHARE

Sharing to:

- WhatsApp;
- SMS;
- iMessage;
- Telegram;
- email;
- other OS share targets;

should send a canonical Nelyon link.

The link should provide a rich preview when supported:

- thumbnail;
- title/caption;
- Nelyon identity;
- canonical URL.

Opening link:

if app installed
→ open exact content.

if app not installed
→ safe web/landing destination
→ App Store / Google Play path where appropriate.

Required technologies should be audited before implementation:

- Universal Links;
- Android App Links;
- deep linking;
- Open Graph metadata;
- canonical web route;
- deferred-install behavior where supported.

#### REPOST / RESHARE

Users must be able to repost eligible content
to their profile/feed.

Repost must:

- preserve original author;
- preserve original media authority;
- avoid duplicating media files;
- preserve attribution;
- preserve deletion/privacy authority;
- preserve moderation authority.

For advertisements:

- sponsored status must remain explicit;
- campaign attribution must remain intact;
- repost must never transform an ad into
  anonymous organic content.

Premium/exclusive content:

NEVER externally share or repost protected assets.

### ROADMAP 6 — PUBLISHER / PLUS BUTTON / CREATION UX V2

STATUS:

PENDING / CURRENT UX NEEDS REDESIGN.

The current "+" publishing flow is considered
too redundant and insufficiently modern.

Target:

one clean, intuitive creation entry point.

Avoid unnecessary chains of dialogs such as:

choose plus
→ choose photo
→ choose carousel
→ choose another redundant content type
→ etc.

Design a unified composer that intelligently supports:

- photo;
- video;
- carousel;
- Reel;
- Story;
- other approved content types.

The UX should be:

- simple;
- fast;
- modern;
- obvious;
- low-friction.

#### COVER / THUMBNAIL SELECTION

When publishing video:

creator must be able to choose the cover/thumbnail.

Possible source:

- video frame;
- permitted custom image.

One canonical thumbnail authority should be reusable by:

- profile grid;
- Feed preview;
- Reel preview;
- web preview;
- share rich preview.

Do NOT build separate thumbnail systems for every surface.

### ROADMAP 7 — PROFILE MEDIA GRID / THUMBNAIL HARDENING

STATUS:

KNOWN PRODUCT DEFECT / PENDING AUDIT.

Current reported behavior:

some creator/profile video tiles appear as black boxes
instead of usable thumbnails.

Before correcting:

audit whether failure is in:

- thumbnail generation;
- thumbnail persistence;
- media association;
- Cloudflare media metadata;
- client rendering;
- caching;
- missing fallback;
- historical records.

Do NOT guess root cause.

Required final behavior:

- visible profile thumbnails;
- stable loading;
- correct aspect ratio;
- no black placeholder after media is ready;
- creator-selected covers where supported;
- safe fallback;
- old media compatibility.

### ROADMAP 8 — PREMIUM REDESIGN / DESIGN SYSTEM / UX

STATUS:

PENDING AS A COMPLETE APP-WIDE MACRO.

Existing isolated redesigns do NOT equal
a completed app-wide premium redesign.

Goal:

modern, premium, consistent Nelyon UI.

Cover:

- buttons;
- typography;
- spacing;
- iconography;
- navigation;
- sheets;
- modals;
- dialogs;
- forms;
- empty states;
- loading;
- errors;
- cards;
- Feed controls;
- profile;
- upload;
- Stories;
- Chat;
- LIVE;
- Battles;
- Marketplace;
- wallet;
- settings;
- onboarding.

Do not change business logic merely for aesthetics.

Approved Figma nodes become visual authority
for their specific phase.

### ROADMAP 9 — INTERNATIONALIZATION / LANGUAGES

STATUS:

PENDING AS GLOBAL FOUNDATION.

Initial required languages:

- Spanish;
- English.

Goal:

avoid user-facing strings scattered directly
through UI components.

Create/reuse one localization authority.

Require:

- language selection;
- locale persistence;
- fallback language;
- date/time formatting;
- number formatting;
- currency presentation;
- pluralization;
- translated accessibility labels;
- translated errors;
- translated onboarding;
- translated settings.

Internal identifiers, SQL enums, RPC names and
database authority do NOT get renamed just for translation.

Architecture should allow future languages
without duplicating screens.

### ROADMAP 10 — CHAT V2 FINAL PHYSICAL CLOSURE

STATUS:

ADVANCED / OPEN.

Do not rebuild Chat.

Perform the remaining physical validation matrix.

Validate:

- direct text;
- images;
- one-time media;
- voice;
- receipts;
- typing;
- presence;
- direct calls;
- groups;
- group media;
- group voice;
- group calls;
- notifications;
- foreground/background;
- killed-state;
- cold start;
- multidispositivo;
- offline/retry;
- pagination;
- long calls.

Only proven defects create corrective phases.

### ROADMAP 11 — SUPERUSER GLOBAL ADMIN FINALIZATION

STATUS:

PARTIAL / OPEN.

Audit existing admin system before adding anything.

Target one global administrative authority covering
the intended product domains without creating
parallel admin architecture.

Must include proper:

- authentication;
- role authority;
- audit logs;
- permissions;
- production safety;
- user/content moderation;
- commerce/admin visibility;
- Ads administration;
- operational health where approved.

### ROADMAP 12 — BUSINESS ADS / SELLER CENTER FINAL CLOSURE

STATUS:

ADVANCED / OPEN.

Do not rebuild existing Business Ads or Seller Center.

Perform remaining:

- real production workflow validation;
- V4 audience validation;
- campaign targeting validation;
- billing/provider integration when available;
- browser QA;
- authorization/security QA;
- analytics validation.

Preserve:

one Ads authority.

Preserve:

one Marketplace/Seller authority.

### ROADMAP 13 — STRIPE PRODUCTION ROADMAP

STATUS:

EXTERNAL BLOCKER / OPEN.

Requires real Stripe account and production credentials.

Stripe is an external fiat/card rail.

Nelyon ledger remains the internal financial authority.

Required before closure:

- real account;
- secrets;
- webhook;
- event isolation;
- idempotency;
- USD → BDAG rules;
- success binding;
- refunds;
- disputes;
- replay/order handling;
- production URLs;
- real test transactions;
- reconciliation.

No parallel wallet.

### ROADMAP 14 — FINAL MODULE-BY-MODULE ARCHITECTURE AUDIT AND CODEBASE CLEANUP

STATUS:

PENDING.

This is a mandatory deep audit.

Audit module by module:

- Auth;
- onboarding;
- Feed;
- ALGO-6;
- profile;
- publisher/upload;
- Creator Studio;
- media;
- Stories;
- Chat;
- calls;
- LIVE;
- Battles;
- gifts;
- wallet;
- ledger;
- withdrawals;
- Marketplace;
- Creator Commerce;
- Premium Content;
- Ads;
- Seller Center;
- Business Web;
- Admin;
- notifications;
- deep links;
- storage;
- Cloudflare;
- Supabase;
- native integrations.

Find and classify:

- orphan code;
- dead code;
- unreachable routes;
- duplicate components;
- duplicate services;
- duplicate hooks;
- duplicate stores;
- parallel authorities;
- obsolete adapters;
- unused dependencies;
- stale feature flags;
- abandoned experiments;
- old media pipelines;
- duplicate listeners;
- duplicate timers;
- unnecessary network calls.

Deletion rules:

DO NOT delete because code "looks old."

For every removal:

- prove no callers;
- prove no runtime authority;
- prove no migration dependency;
- prove no production dependency;
- add/regress tests;
- inspect Git history where needed.

Do NOT delete historical migrations.

Do NOT blindly drop production tables/RPCs.

### ROADMAP 15 — PERFORMANCE / STABILITY OPTIMIZATION

STATUS:

PENDING.

Goal:

Nelyon must feel fast and stable.

Measure before optimizing.

Audit:

- cold start;
- warm start;
- navigation;
- Feed load;
- Feed scrolling;
- image loading;
- video startup;
- thumbnail loading;
- memory;
- CPU;
- GPU;
- temperature;
- camera;
- Banuba;
- Agora;
- LIVE;
- Battles;
- upload;
- export;
- network calls;
- SQL/RPC latency;
- indexes;
- realtime subscriptions;
- duplicate listeners;
- background/foreground;
- battery;
- cache;
- bundle size.

Test:

- modern devices;
- lower-performance supported devices;
- poor network;
- reconnect;
- long sessions.

No speculative index or caching changes
without measured evidence.

### ROADMAP 16 — FINAL QA / SECURITY / PRODUCTION RELEASE

STATUS:

PENDING.

This is the final product closure.

Requires complete regression across all
production-critical systems.

Include:

- iOS;
- Android;
- supported web surfaces;
- auth;
- onboarding;
- Feed;
- profile;
- Creator Studio;
- Premium Content;
- Stories;
- Chat;
- calls;
- LIVE;
- Battles;
- Marketplace;
- wallet;
- finance;
- Ads;
- Seller Center;
- Admin;
- notifications;
- deep links;
- localization;
- accessibility;
- offline/recovery.

Security audit:

- RLS;
- RPC authorization;
- SECURITY DEFINER;
- storage;
- signed media;
- private content;
- secrets;
- Edge Functions;
- idempotency;
- concurrency;
- rate limiting;
- abuse controls.

Financial audit:

- ledger;
- wallet;
- gifts;
- Marketplace;
- creator commissions;
- refunds;
- disputes;
- withdrawals;
- Ads;
- Stripe.

Final release occurs only after explicit owner authorization.

## 8. KNOWN EXTERNAL BLOCKERS

Maintain this section over time.

Initial blockers:

### BANUBA

Need vendor response,
commercial access/trial,
license details and compatibility POC.

### STRIPE

Need real Stripe account and production credentials.

### MUSIC

Need legally valid licensing/catalog authority
before commercial music distribution.

### APP STORE / GOOGLE PLAY ADULT-CONTENT COMPLIANCE

Premium intimate/nude content cannot be assumed
launchable until policy/legal review is complete.

## 9. KNOWN OWNER PRODUCT DECISIONS

Record and preserve:

- Nelyon is the current product/brand name.
- Marketplace is not the home for creator-exclusive discovery.
- Exclusive creator content belongs to creator experience.
- Premium paid content must not be publicly downloadable/shareable.
- Premium protected assets must remain private.
- Banuba is intended for advanced creator editing/AR.
- Banuba AR should power premium Battle gift effects after POC.
- Music must become real licensed editing/render functionality,
  not metadata-only.
- Stories must include interactive polls/sliders/questions/quiz.
- Public content sharing must support rich link previews.
- Public eligible content should support repost/reshare.
- Premium content must NEVER use normal public sharing.
- Publisher "+" UX must become cleaner and less redundant.
- Video publishing must support a real cover/thumbnail.
- Black profile thumbnails are a known defect requiring audit.
- App-wide redesign must be modern/premium/intuitive.
- Spanish and English localization are required.
- Final cleanup must remove proven orphan/dead code.
- Final performance work must address lag, freezing and latency.
- No duplicate architecture.

## 10. CURRENT NEXT PLANNED MACRO

NEXT PLANNED:

CREATOR PREMIUM / EXCLUSIVE CONTENT

Important:

This roadmap entry does NOT authorize implementation.

Owner must explicitly authorize the audit/design/implementation phase.

## 11. ROADMAP UPDATE PROTOCOL

After every owner-approved macro closure,
update this SAME file.

Every update should include:

- date;
- affected roadmap item;
- old status;
- new status;
- final branch;
- final SHA;
- migration if applicable;
- production result;
- physical validation result;
- remaining risks;
- next planned macro.

Do not rewrite historical facts silently.

Use a CHANGELOG section at the end.

## 12. CHANGELOG

### v1.0 — 2026-10-06

Created the canonical Nelyon roadmap.

Initial canonical Git base:

`3a29a8bc3042d4cd7c299b6f3ac018c543dcd340`

Recorded:

- completed foundations;
- ALGO-6 closure;
- current partial systems;
- Creator Premium/Exclusive Content;
- Banuba/Creator Studio;
- music;
- Banuba Battle AR gifts;
- Interactive Stories;
- rich sharing/deep links;
- repost;
- Publisher V2;
- thumbnails/profile media;
- premium redesign;
- localization;
- Chat closure;
- Superuser;
- Ads/Seller closure;
- Stripe;
- final cleanup;
- performance;
- final QA.

END OF CANONICAL ROADMAP.
