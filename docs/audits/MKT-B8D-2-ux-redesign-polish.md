# MKT-B8D-2 — Marketplace UX / Redesign / Polish

Audit date: 2026-08-15 (America/New_York)  
Branch: `codex/mkt-a4b-premium-integration`  
Starting SHA: `ad061603f087c6858d0be440a20bdf0f357ddd73`  
Build: 22  
Remote migration baseline: `20260811033000_marketplace_production_hardening.sql`

## Scope and freeze

B8D-2 is a presentation and interaction closure. No migration, Edge Function, RLS/grant, economic service, idempotency authority, pagination RPC, or reconciliation definition was changed. The audit inspected source and exercised jsdom/static behavior; it did not perform or claim physical-device or manual-browser testing. B8D-3 and B8D-4 were not started.

## Screen inventory

The inventory below records the implemented route, source, purpose/CTA, and current resilience. “Confirm” means the existing native mobile alert contract; “dialog” means the new Admin app-level dialog.

### Buyer

| Route / entry | Source | Purpose and CTA | States / layout / accessibility audit |
|---|---|---|---|
| `/(tabs)/shop` | `app/(tabs)/shop.tsx` | Discovery, search, category/sponsored selection; open product | Virtualized feed, loading/empty/error paths, explicit sponsored labels, image fallback, touch controls, wrapping cards and safe-area behavior retained. No ad tracking change. |
| `/product/[id]` | `app/product/[id].tsx`, `components/marketplace/product-detail/*` | Media, variants, availability, save, add to cart/buy | Gallery and purchase bar keep safe bottom reachability, physical/digital contracts, status and price hierarchy; no client economic authority added. |
| cart entry / `/cart` | `app/cart.tsx` | Review items, quantity, remove/clear, continue to checkout | Hydration/loading, empty state and CTA, refresh warning, inventory/price-change notice, 44px controls, destructive “Vaciar” confirmation, safe bottom summary. Display subtotal remains explicitly subject to server checkout revalidation. |
| `/checkout` | `app/checkout.tsx` | Destination and shipping eligibility; create reservation | KeyboardAvoidingView, address validation, quote loading/error, submission lock, safe-area bottom content. Canonical checkout receipt remains authoritative. |
| `/checkout/reservation/[id]` | `app/checkout/reservation/[id].tsx` | Review canonical reservation and pay | Expiration/payment loading and explicit final action retained; duplicate visual submission remains disabled by existing state and server idempotency. |
| `/my-orders`, `/orders` | `app/my-orders.tsx`, `app/orders/index.tsx` | Buyer order history | Loading/empty/error/retry and status grouping retained. |
| `/orders/[id]` | `app/orders/[id].tsx`, `components/marketplace/MarketplaceDisputePanel.tsx`, `components/marketplace/OrderStatus.tsx` | Timeline, tracking, delivery confirmation, problem/dispute | Consequence-bearing actions keep explicit native confirmations; server state transitions unchanged. Long IDs and financial facts use existing validated models. |
| saved product control | `app/product/[id].tsx`, Shop state | Save/remove product | Icon control has textual accessibility label and selected state. No new saved-data surface was invented. |
| Creator/LIVE product entry | `components/marketplace/CreatorContentProductSheet.tsx`, `components/live/shop/*` | Enter canonical product/checkout from content or LIVE | Existing source attribution, safe-area sheets, variant/shipping/payment states retained. LIVE Battles was not touched. |

### Seller

| Route | Source | Purpose and CTA | States / layout / accessibility audit |
|---|---|---|---|
| `/seller` | `app/seller/index.tsx`, `components/marketplace/SellerCenterUI.tsx` | Operational dashboard; products/orders/inventory/shipping/promotions/Ads/analytics | Loading skeletons, access/restricted/store states, per-section retries and empty states. Shared metric cards now stack at 360px and below, shrink large BDAG text safely, use tabular figures, and preserve 44px controls. |
| `/seller/products` | `app/seller/products.tsx`, `hooks/useShop.tsx` | Filter, edit, inventory, publish/pause/delete, load more | B8D keyset continuation, dedupe, refresh reset, terminal stop and loading footer retained. Product delete remains a two-stage destructive confirmation with explicit labels. |
| `/seller/product-editor/[productId]` | route file plus `components/marketplace/product-editor/*` | Draft/save/readiness/media/variants/shipping/affiliate controls | Existing progress, validation, autosave, upload retry, physical/digital branches, keyboard scroll and shipping continuation retained. No publication or affiliate economics change. |
| `/seller/product/[id]/variants` | `app/seller/product/[id]/variants.tsx` | Variant options, SKU, stock and save | Unsaved-change confirmation and destructive/archive spacing retained; no inventory authority change. |
| `/seller/store` | `app/seller/store.tsx` | Store identity/configuration | Existing form/loading/error and seller ownership preserved. |
| `/seller/shipping-profile` | `app/seller/shipping-profile.tsx` | Profile, origin, destinations, rates, policy | Explicit error/success feedback and paginated selection in product editor retained; profiles after page one remain reachable. |
| `/seller/promotions` | `app/seller/promotions.tsx` | Filter/create/end promotions and select eligible product/variant | Promotion and product cursors remain independently user-driven; row 101 remains reachable without eager draining. End confirmation uses explicit cancel/finalize labels. |
| `/seller/orders`, `/seller/orders/[id]` | route files | Fulfilment queue, processing/shipping | Keyset list, refresh/error/retry, explicit preparation/shipping confirmation and tracking validation retained. |
| `/seller/analytics` | `app/seller/analytics.tsx`, shared Seller Center UI | Range, GMV, rates, products/variants/sources | Shared responsive metrics/BDAG typography improved; canonical analytics and caveat text unchanged. |
| `/seller/ads`, `/seller/ads/create`, `/seller/ads/[id]` | route files | Campaign lifecycle/eligibility/performance | Existing lifecycle state, budget/spend display, pause/resume and canonical service calls retained. No spend/release/finalization calculation or authority added. |

### Creator

| Route / entry | Source | Purpose and CTA | States / layout / accessibility audit |
|---|---|---|---|
| `/creator-showcase` | `app/creator-showcase.tsx` | Browse eligible products; add, reorder, remove | Keyset load-more, refresh, search, selected/unavailable state and 44px add control retained. Removal now states public consequence, provides Cancel and “Remove product”, and does not mutate merely by opening the alert. Historical attribution is explicitly unaffected. |
| content product tagging | `components/marketplace/CreatorContentProductSelector.tsx`, `CreatorContentProductSheet.tsx` | Search/select/remove eligible Feed/Reel products | Eligibility, selected state, pagination, error/empty and commission projection retained; no BPS authority change. |
| `/creator-commerce-analytics` | `app/creator-commerce-analytics.tsx` | Range, attributed GMV, generated/released/reversed/net commission, surfaces/products | Existing loading/error/retry/empty, range selector and compact metrics retained. B7D temporal semantics and BPS validation untouched. |
| LIVE commerce | `components/live/shop/LiveHostShopManager.tsx`, `components/live/shop/*` | Eligible product rail/bag, variant/shipping/payment | Existing accessibility labels, sheet states and canonical LIVE attribution retained; no LIVE business rule or Battles work. |

### Admin Web

| Route | Source | Purpose | Audit result |
|---|---|---|---|
| `/marketplace` | `MarketplaceOverviewPage.tsx` | Marketplace operational summary | Loading/error/retry, range and metrics retained. |
| `/marketplace/orders[/:id]` | order pages | Bounded order search/detail | Responsive table contract and detail hierarchy; finance remains read-only. |
| `/marketplace/disputes[/:id]` | dispute pages | Search/detail/privileged resolution | Responsive table; required reason and new accessible app dialog; canonical receipt validation/idempotency unchanged. |
| `/marketplace/sellers[/:id]` | seller pages | Search/detail/moderation | Responsive table; app dialog; store state remains canonical. |
| `/marketplace/products[/:id]` | product pages | Search/detail/moderation | Responsive table; app dialog; no catalog/economic editor. |
| `/marketplace/creator-commerce[/:id]` | `MarketplaceIntelligencePages.tsx` | Creator intelligence/detail | Responsive list, bounded cursor, strict payload validation unchanged. |
| `/marketplace/promotions[/:id]` | intelligence pages | Promotion observation | Responsive list; no mutation. |
| `/marketplace/ads[/:id]` | intelligence pages | Marketplace Ads observation | Responsive list; no Ads financial mutation. |
| `/marketplace/health` | intelligence pages | 15 canonical health groups and attention | Group/counter semantics unchanged; narrow cards and long values retain wrapping. |
| `/marketplace/activity` | intelligence pages | Immutable privileged action trail | Responsive list; bounded filters/pagination and immutability unchanged. |

## B8D-006 — narrow Admin navigation

Before: at `max-width:720px` the ten links became one horizontal flex row with no bounded overflow or compact control, making later routes unreachable at 320–480px.

Correction: `AdminShell` now exposes a labelled `Menú` button with `aria-expanded` and `aria-controls`. At narrow widths the sticky header opens a bounded, vertically scrollable grid; it becomes one column at 420px. Route changes close the menu. Desktop navigation is unchanged. Every current route remains in the same semantic navigation landmark.

Proof: `adminUx.test.tsx` opens the menu and verifies all ten hrefs. The B8D-2 static test verifies breakpoints, bounded height and overflow contract. Physical/manual verification remains for B8D-3.

## B8D-007 — narrow Admin tables

Before: the stylesheet hid `.table-head` below 1050px and changed values to unlabeled grids. Operators could not reliably associate values with columns.

Correction: one late, explicit responsive contract keeps headers visible, applies a stable 860px operational grid, and puts every existing `.table-panel` in horizontal overflow with contained overscroll and a stable scrollbar gutter. Values retain wrapping and the header remains sticky inside the scroll plane. Pagination stays reachable and uses the same width contract. No column or critical datum was removed.

Proof: the static closure gate inventories orders, disputes, sellers, products and the four intelligence/activity list uses in `MarketplaceIntelligencePages.tsx`, and verifies the final breakpoint overrides. Browser visual measurement is intentionally deferred to B8D-3.

## B8D-008 — privileged confirmations

Before: `OperationConfirm` invoked native `window.confirm`, which had inconsistent semantics, no consequence/reason context, no app focus control and limited testability.

Correction: `ConfirmDialog` implements `role=dialog`, `aria-modal`, labelled title/description, visible reason, explicit Cancel/action labels, destructive styling, initial safe focus, Tab containment, Escape cancel when safe, backdrop cancel, responsive action stacking and focus restoration. Opening performs no mutation. A synchronous lock plus pending-disabled action prevents double submission. Existing fingerprint/idempotency retry logic and reason maxima (100 disputes, 500 seller/product) are preserved.

Proof: DOM tests cover open-without-mutation, cancel-without-mutation, reason required, exactly one call, disabled/busy submit, controlled error, stable retry key and success. There is no `window.confirm` in Admin source.

## Shared presentation changes

Mobile reused the existing theme and Seller Center primitives rather than introducing a second design system. Seller metrics use the current colors/spacing/radius/type tokens, become single-column at 360px and below, apply a safe minimum font scale for long validated BDAG values, and use tabular numerals. Section headers permit long labels to shrink without pushing actions off-screen. Touch targets remain at least 44px.

Admin reused existing panels, badges, PageState, typography and colors. The additions are limited to the navigation toggle, table overflow contract, focus-visible styling and confirmation dialog.

## Loading, empty, error and retry audit

- Buyer cart/checkout/order paths distinguish loading, empty, connectivity failure, server validation and retry. No malformed financial response is converted to zero.
- Seller products, promotions and shipping continuation distinguish initial load, refresh, page load and retry; no eager cursor drain was introduced.
- Seller dashboard and analytics expose section-level skeleton/error/empty states.
- Creator Showcase and analytics expose initial, refresh, continuation, empty and retry states.
- Admin pages retain PageState loading/empty/error/retry; the dialog reports mutation success/failure without shell crashes.

## Dangerous-action audit

- Mobile cart clearing, product deletion, promotion ending, delivery/fulfilment transitions and Creator Showcase removal have explicit consequence text, Cancel and descriptive action labels.
- Admin dispute/seller/product operations now require an app dialog and retain domain reason rules.
- No dialog opening executes its action; pending actions disable repeats.
- Visual/destructive copy does not change canonical state transition availability.

## Responsive and performance strategy

Source reasoning covers 320, 360, 375/390 and 430px mobile widths and 320, 480, 768, 1024 and 1440px Admin widths. Changes avoid ScrollView replacements for large lists, eager pagination, N+1 calls, new dependencies and heavy animation. Existing FlatList/keyset continuation remains. Admin tables use CSS overflow rather than duplicated data rendering.

## Accessibility strategy

Important mobile controls retain semantic button/tab roles, selection/disabled state and explicit labels. The shared seller range targets are now 44px. Admin gains visible keyboard focus, semantic menu state and a modal focus loop. Status remains textual in addition to color.

## Automated evidence

Final counts are recorded after the full gate run. The targeted implementation gate includes:

- Admin DOM: responsive nav route reachability.
- Admin DOM: privileged dialog open/cancel/confirm/pending/retry behavior.
- Static: all critical responsive table surfaces and CSS breakpoints.
- Static: seller continuation contracts remain present.
- Static: Creator Showcase destructive confirmation.
- Static: Build 22, migration tip and absence of new authority/later-phase work.

## B8D-3 physical test matrix — planning only

B8D-3 is **not started**. A human must later verify:

| Platform | Required journeys |
|---|---|
| iPhone, narrow and current large size | Shop discovery/search/sponsored disclosure; physical and digital product; save/cart/checkout/payment; order detail/delivery/problem; Seller dashboard/products continuation/editor keyboard/media/variants/shipping profile after page one/promotions/analytics/Ads; Creator Showcase add/reorder/remove, content tagging, analytics; LIVE product bag and checkout; safe areas, rotation policy, VoiceOver labels and dynamic text risks. |
| Android, narrow and current large size | Same critical buyer/seller/creator/LIVE journeys; system back; keyboard resize; TalkBack order; native Alerts; list end reach/refresh; long names and large BDAG; low-memory image fallback. |
| Desktop browsers at 1440/1024/768/480/320 logical widths | Login/access denial; all ten Admin routes; menu open/close/navigation; all operational tables and pagination; detail links; dialog Tab/Shift+Tab/Escape/cancel/confirm/pending/error/retry; Health long counters; long seller/product/admin names; browser zoom at 200%. |

No item in this matrix was executed or claimed during B8D-2.

## Remaining limitations and severity

- Visual layout was not physically/manual-browser tested; this is the intended B8D-3 scope, not a B8D-2 correctness finding.
- OS font scaling, screen-reader announcement quality, keyboard overlays and actual pointer/touch behavior require the B8D-3 matrix.
- Final automated and remote results are appended below after gates.

Provisional implementation finding count: P0 0, P1 0, correctness-affecting P2 0, P3 0. B8D-006, B8D-007 and B8D-008 are implemented and awaiting independent review plus later physical validation.

## Final gate evidence

- Admin Web: 58/58 tests passed across 5 files; ESLint passed with zero warnings; Vite production build passed (120 modules).
- Marketplace-focused: 179/179 Node tests passed, including B8S/B8A/B8B/B8C/B8D-1H/C1/C2, Seller Center/products/navigation, Promotions, Shipping, Creator, Ads, payment, settlement, held-refund and runtime contracts.
- Full root: 732/732 tests passed, zero failures.
- TypeScript: exactly 187 historical diagnostics; zero diagnostics reference B8D-2 changed TypeScript/TSX files.
- Disposable proofs: production hardening; client runtime; B8S/B8A/B8B/B8C; order lifecycle; held dispute refund; post-settlement reversal (real two-connection case); shipping; publication; Promotions; Creator Commerce; multi-creator allocation; Showcase; content tags; Creator Analytics; LIVE Creator Commerce; Ads finance/eligibility/finalization/delivery/events; Seller Analytics and fixture finalization all passed.
- The schema-only disposable dump omits PostgreSQL's global default-ACL entry. The already-deployed `20260811033000` migration was therefore reapplied **only inside the disposable local container** before the inherited hardening proof; no file or remote history was changed. The proof then confirmed anon/authenticated no schema CREATE or default object access. The container was destroyed afterward.
- Disposable reconciliation: payments, settlements, Creator allocations/analytics/reversals, Ads and B8B Admin Operations were all zero; fixture residue was zero.
- Read-only remote B8D auditor: passed; latest `20260811033000`, 204/204 Marketplace SECURITY DEFINER functions fixed-path, zero broad Marketplace DML, zero null-limit risks, zero exposed dynamic SQL.
- Read-only remote B8C auditor: passed; B8S/B8A/B8B/B8C guards healthy, B8B 8/8 zero, all Creator and Ads groups zero, payment failures zero, settlement failures zero, escrow expected/actual 71/71, fixtures zero, failure hooks absent.
- No migration was created, no Supabase/Edge/Admin deploy occurred, no EAS/mobile build ran, and Build remained 22.

Final findings: P0 0; P1 0; correctness-affecting P2 0; open B8D-2 P3 0. B8D-006, B8D-007 and B8D-008 are closed by implementation and automated evidence, subject to independent review. Physical/manual validation remains exclusively in the documented B8D-3 matrix and was not started.

## MKT-B8D-2-C1 — Creator Mobile UX Closure

Starting baseline: `016047c0fcf772d526bc6fabe7736fb317d62f24`, branch `codex/mkt-a4b-premium-integration`, Build 22, remote migration `20260811033000_marketplace_production_hardening.sql`. The worktree and local/origin branch were clean and identical; both inherited read-only remote auditors passed before the correction. Accepted Admin findings B8D-006, B8D-007 and B8D-008 were not reopened.

Touch targets: the Creator Showcase move-up, move-down and remove Pressables now have actual 44×44 logical-pixel boxes. The icon sizes did not substitute for the interactive bounds. The vertical action rail remains outside the flexible copy area and does not introduce a per-card horizontal ScrollView.

Accessibility: all three icon-only management actions declare `accessibilityRole="button"` and retain descriptive Spanish labels. Their `accessibilityState.disabled` values exactly follow the native `disabled` expressions: first-or-busy for move up, last-or-busy for move down, and busy for remove. Visual opacity remains supplementary and is not the only disabled signal. The existing destructive Alert still opens before any removal call, offers `Cancelar` and the explicit `Quitar producto` action, and performs the service mutation only from that action callback.

Language consistency: user-visible Creator Showcase navigation, subtitle, tabs, search, loading, error/retry, empty states, availability, commission, actions, accessibility labels and Alerts are normalized to the existing Spanish Marketplace convention. Database enums, RPC/service names, error codes, IDs and Creator economic semantics were not translated or changed.

Narrow-width reasoning: at 320px, the list leaves a 288px card after its 16px side insets. Card padding and the 8px card gap leave a bounded row containing the non-shrinking 44px action rail and a flexible product region. Within that region, the 82px image remains usable while `productTap`, copy and search/header text use `minWidth:0`, allowing long names/copy to shrink, truncate or wrap instead of pushing controls outside the card. The same contract has additional space at 360, 390 and 430px. Three management actions remain vertically reachable without horizontal scrolling.

Automated evidence:

- B8D-2 focused closure: 6/6 passed, including 44×44 dimensions, role/state wiring, Spanish copy, no horizontal card scrolling, confirmation-before-mutation ordering and unchanged add/remove/reorder service contracts.
- Admin Web: 58/58 passed; ESLint passed with zero warnings; Vite production build passed with 120 modules.
- Full root Node: 733/733 passed, zero failures.
- TypeScript: exactly 187 historical diagnostics; zero diagnostics in the C1 changed files.
- Build remained 22. No migration, Supabase push, Edge/Admin deploy, EAS or mobile build was performed.
- Final read-only B8D auditor: passed at `20260811033000`, 204/204 Marketplace SECURITY DEFINER functions fixed-path, zero broad Marketplace DML, zero null-limit risks and zero exposed dynamic SQL.
- Final read-only B8C auditor: passed; B8B 8/8 zero, all Creator and Ads failure counters zero, payment and settlement failure counters zero, escrow expected/actual 71/71, fixtures zero and failure hooks absent.

No Marketplace service, database, attribution, commission or other economic authority changed. Historical migrations are unchanged. B8D-3 was not started or simulated.

## MKT-B8D-2R — SHOP-ONLY REFINEMENT

Baseline: `54dd94adecdc61a719bd57e56075319953ce19a8`, branch `codex/mkt-a4b-premium-integration`, Build 22, remote migration `20260811033000_marketplace_production_hardening.sql`. The worktree and local/origin branch were clean and identical. The B8D hardening and inherited B8C read-only auditors passed before UX work.

### Source inventory

- Marketplace main route and its local product/creator/exclusive cards: `app/(tabs)/shop.tsx`.
- Public product detail: `app/product/[id].tsx`.
- Product gallery and sticky purchase controls: `components/marketplace/product-detail/ProductMediaGallery.tsx` and `ProductPurchaseBar.tsx`.
- Public creator profile, normal content, exclusive content and Showcase products: `app/creator/[id].tsx`.
- Exclusive profile data source: the existing `fetchCreatorExclusiveContent()` path in `services/creatorService.ts`; purchase/ownership remains in the existing economy service.
- Product catalog, detail/runtime validation and physical/digital contract: `services/marketplaceService.ts` (audited, unchanged).
- Marketplace top segmented control before refinement: the local `SHOP_TABS` definition in `shop.tsx`, with `Descubrir`, `Market` and `Exclusivo`.

### Marketplace information architecture

Before: the Marketplace route defaulted to creator discovery and mixed creator cards, subscriptions, products and global exclusive content behind three top-level tabs. Product search existed only inside the market branch, while the visible landing copy emphasized discovery and monetization.

After: the route is one shop-only surface. It opens directly to a product catalog with a commerce header, wallet/cart access, product/store search, canonical category chips, a compact seller entrypoint, product results, explicit sponsored presentation and loading/empty/error/retry states. Creator discovery/subscription cards and the global Exclusive branch/imports/loaders were removed from this route. Sponsored impression/click recording, source propagation and product RPC authority are preserved.

Product cards now use a square commerce image, clear category or sponsored badges, sold-out overlay, two-line title, store identity, prominent tabular BDAG price and sales/new-product context. `useWindowDimensions()` calculates a two-column grid at 320, 360, 390 and 430px without horizontal overflow; flexible header/search copy uses `minWidth:0`. No eager pagination drain, N+1 detail read or new recommendation backend was added.

### Creator profile ownership of exclusive content

The existing public creator profile already owned the correct creator-scoped exclusive data and purchase semantics. Its visible normal-content tab is now `Contenido`, paired with `Exclusivo`; the optional existing `Productos` Showcase tab remains. Tabs now expose semantic tab roles, labels and selected state. No paywall, subscription, purchase or Creator economics changed.

### Product detail redesign

- Top bar: balanced 44×44 back, share, save and cart controls with existing labels/state.
- Gallery: responsive square hero media up to 430px, premium empty treatment, readable media count and 66×66 selectable image/video thumbnails.
- Core commerce: raised product surface, product-type/category pill, stronger title, prominent blue tabular BDAG price, comparison/discount, sales and canonical availability.
- Variants: distinct customization section, concise selected summary, 44px radio chips with check feedback and disabled/selected semantics; large option sets keep the existing searchable selector.
- Confidence: payment protection, server-derived stock and shipping presentation are visually grouped; canonical shipping quote, seller contact, description, details and BDAG trust sections remain.
- CTA: sticky two-row purchase surface keeps 44px quantity controls, displays the validated unit price, offers `Agregar` and `Comprar ahora`, and invokes only the existing locked `handleAddToCart()` / `handleAddToCart(true)` paths. The latter still adds the exact selected canonical variant and routes to the existing checkout. No payment or total authority moved client-side.
- Layout: scroll padding and toast placement account for the taller action bar; two full-width CTA actions remain readable at 320px.

### Files changed

- `app/(tabs)/shop.tsx`
- `app/creator/[id].tsx`
- `app/product/[id].tsx`
- `components/marketplace/product-detail/ProductMediaGallery.tsx`
- `components/marketplace/product-detail/ProductPurchaseBar.tsx`
- `tests/marketplaceMktB7BShowcase.test.mjs` (Spanish buy-now expectation only)
- `tests/marketplaceMktB7CContentTags.test.mjs` (Spanish creator-context expectation only)
- `tests/marketplaceRuntimeVisibility.test.mjs` (shop-only loading/error/retry contract)
- `tests/marketplaceMktB8D2ShopRefinement.test.mjs`
- `docs/audits/MKT-B8D-2-ux-redesign-polish.md`

### Automated and remote evidence

The dedicated refinement proof covers removal of the mixed Marketplace tabs and creator/exclusive loaders, the shop-only search/category/product structure, creator `Contenido` / `Exclusivo` tabs, premium gallery/pricing/variant/CTA structure, narrow-width/accessibility contracts, exact cart/checkout continuation, physical/digital validation retention, Build 22, migration `33000`, and absence of financial/later-phase authority.

- Refinement and related focused tests: 85/85.
- Admin Web: 58/58; lint passed with zero warnings; production build passed (120 modules).
- Complete root Node suite: 739/739.
- Root TypeScript baseline: exactly 187 historical diagnostics and zero diagnostics in B8D-2R production files.
- Read-only B8D hardening auditor: passed at `20260811033000`; no broad Marketplace DML, dynamic SQL, null-limit or unsafe search-path findings.
- Read-only inherited B8C auditor: passed at `20260811033000`; B8B 8/8, Creator and Ads failure counters zero, payments/settlements healthy, escrow expected/actual 71/71, fixtures zero and failure hook absent.

No SQL migration, Supabase push, Edge/Admin deployment, EAS or mobile build is part of this refinement. B8D-3, B8D-4 and LIVE Battles were not started.
