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

| Route / entry                | Source                                                                                                                | Purpose and CTA                                               | States / layout / accessibility audit                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/(tabs)/shop`               | `app/(tabs)/shop.tsx`                                                                                                 | Discovery, search, category/sponsored selection; open product | Virtualized feed, loading/empty/error paths, explicit sponsored labels, image fallback, touch controls, wrapping cards and safe-area behavior retained. No ad tracking change.                                                              |
| `/product/[id]`              | `app/product/[id].tsx`, `components/marketplace/product-detail/*`                                                     | Media, variants, availability, save, add to cart/buy          | Gallery and purchase bar keep safe bottom reachability, physical/digital contracts, status and price hierarchy; no client economic authority added.                                                                                         |
| cart entry / `/cart`         | `app/cart.tsx`                                                                                                        | Review items, quantity, remove/clear, continue to checkout    | Hydration/loading, empty state and CTA, refresh warning, inventory/price-change notice, 44px controls, destructive “Vaciar” confirmation, safe bottom summary. Display subtotal remains explicitly subject to server checkout revalidation. |
| `/checkout`                  | `app/checkout.tsx`                                                                                                    | Destination and shipping eligibility; create reservation      | KeyboardAvoidingView, address validation, quote loading/error, submission lock, safe-area bottom content. Canonical checkout receipt remains authoritative.                                                                                 |
| `/checkout/reservation/[id]` | `app/checkout/reservation/[id].tsx`                                                                                   | Review canonical reservation and pay                          | Expiration/payment loading and explicit final action retained; duplicate visual submission remains disabled by existing state and server idempotency.                                                                                       |
| `/my-orders`, `/orders`      | `app/my-orders.tsx`, `app/orders/index.tsx`                                                                           | Buyer order history                                           | Loading/empty/error/retry and status grouping retained.                                                                                                                                                                                     |
| `/orders/[id]`               | `app/orders/[id].tsx`, `components/marketplace/MarketplaceDisputePanel.tsx`, `components/marketplace/OrderStatus.tsx` | Timeline, tracking, delivery confirmation, problem/dispute    | Consequence-bearing actions keep explicit native confirmations; server state transitions unchanged. Long IDs and financial facts use existing validated models.                                                                             |
| saved product control        | `app/product/[id].tsx`, Shop state                                                                                    | Save/remove product                                           | Icon control has textual accessibility label and selected state. No new saved-data surface was invented.                                                                                                                                    |
| Creator/LIVE product entry   | `components/marketplace/CreatorContentProductSheet.tsx`, `components/live/shop/*`                                     | Enter canonical product/checkout from content or LIVE         | Existing source attribution, safe-area sheets, variant/shipping/payment states retained. LIVE Battles was not touched.                                                                                                                      |

### Seller

| Route                                                   | Source                                                              | Purpose and CTA                                                                    | States / layout / accessibility audit                                                                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/seller`                                               | `app/seller/index.tsx`, `components/marketplace/SellerCenterUI.tsx` | Operational dashboard; products/orders/inventory/shipping/promotions/Ads/analytics | Loading skeletons, access/restricted/store states, per-section retries and empty states. Shared metric cards now stack at 360px and below, shrink large BDAG text safely, use tabular figures, and preserve 44px controls. |
| `/seller/products`                                      | `app/seller/products.tsx`, `hooks/useShop.tsx`                      | Filter, edit, inventory, publish/pause/delete, load more                           | B8D keyset continuation, dedupe, refresh reset, terminal stop and loading footer retained. Product delete remains a two-stage destructive confirmation with explicit labels.                                               |
| `/seller/product-editor/[productId]`                    | route file plus `components/marketplace/product-editor/*`           | Draft/save/readiness/media/variants/shipping/affiliate controls                    | Existing progress, validation, autosave, upload retry, physical/digital branches, keyboard scroll and shipping continuation retained. No publication or affiliate economics change.                                        |
| `/seller/product/[id]/variants`                         | `app/seller/product/[id]/variants.tsx`                              | Variant options, SKU, stock and save                                               | Unsaved-change confirmation and destructive/archive spacing retained; no inventory authority change.                                                                                                                       |
| `/seller/store`                                         | `app/seller/store.tsx`                                              | Store identity/configuration                                                       | Existing form/loading/error and seller ownership preserved.                                                                                                                                                                |
| `/seller/shipping-profile`                              | `app/seller/shipping-profile.tsx`                                   | Profile, origin, destinations, rates, policy                                       | Explicit error/success feedback and paginated selection in product editor retained; profiles after page one remain reachable.                                                                                              |
| `/seller/promotions`                                    | `app/seller/promotions.tsx`                                         | Filter/create/end promotions and select eligible product/variant                   | Promotion and product cursors remain independently user-driven; row 101 remains reachable without eager draining. End confirmation uses explicit cancel/finalize labels.                                                   |
| `/seller/orders`, `/seller/orders/[id]`                 | route files                                                         | Fulfilment queue, processing/shipping                                              | Keyset list, refresh/error/retry, explicit preparation/shipping confirmation and tracking validation retained.                                                                                                             |
| `/seller/analytics`                                     | `app/seller/analytics.tsx`, shared Seller Center UI                 | Range, GMV, rates, products/variants/sources                                       | Shared responsive metrics/BDAG typography improved; canonical analytics and caveat text unchanged.                                                                                                                         |
| `/seller/ads`, `/seller/ads/create`, `/seller/ads/[id]` | route files                                                         | Campaign lifecycle/eligibility/performance                                         | Existing lifecycle state, budget/spend display, pause/resume and canonical service calls retained. No spend/release/finalization calculation or authority added.                                                           |

### Creator

| Route / entry                 | Source                                                                                       | Purpose and CTA                                                                      | States / layout / accessibility audit                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/creator-showcase`           | `app/creator-showcase.tsx`                                                                   | Browse eligible products; add, reorder, remove                                       | Keyset load-more, refresh, search, selected/unavailable state and 44px add control retained. Removal now states public consequence, provides Cancel and “Remove product”, and does not mutate merely by opening the alert. Historical attribution is explicitly unaffected. |
| content product tagging       | `components/marketplace/CreatorContentProductSelector.tsx`, `CreatorContentProductSheet.tsx` | Search/select/remove eligible Feed/Reel products                                     | Eligibility, selected state, pagination, error/empty and commission projection retained; no BPS authority change.                                                                                                                                                           |
| `/creator-commerce-analytics` | `app/creator-commerce-analytics.tsx`                                                         | Range, attributed GMV, generated/released/reversed/net commission, surfaces/products | Existing loading/error/retry/empty, range selector and compact metrics retained. B7D temporal semantics and BPS validation untouched.                                                                                                                                       |
| LIVE commerce                 | `components/live/shop/LiveHostShopManager.tsx`, `components/live/shop/*`                     | Eligible product rail/bag, variant/shipping/payment                                  | Existing accessibility labels, sheet states and canonical LIVE attribution retained; no LIVE business rule or Battles work.                                                                                                                                                 |

### Admin Web

| Route                                 | Source                             | Purpose                                  | Audit result                                                                                                         |
| ------------------------------------- | ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/marketplace`                        | `MarketplaceOverviewPage.tsx`      | Marketplace operational summary          | Loading/error/retry, range and metrics retained.                                                                     |
| `/marketplace/orders[/:id]`           | order pages                        | Bounded order search/detail              | Responsive table contract and detail hierarchy; finance remains read-only.                                           |
| `/marketplace/disputes[/:id]`         | dispute pages                      | Search/detail/privileged resolution      | Responsive table; required reason and new accessible app dialog; canonical receipt validation/idempotency unchanged. |
| `/marketplace/sellers[/:id]`          | seller pages                       | Search/detail/moderation                 | Responsive table; app dialog; store state remains canonical.                                                         |
| `/marketplace/products[/:id]`         | product pages                      | Search/detail/moderation                 | Responsive table; app dialog; no catalog/economic editor.                                                            |
| `/marketplace/creator-commerce[/:id]` | `MarketplaceIntelligencePages.tsx` | Creator intelligence/detail              | Responsive list, bounded cursor, strict payload validation unchanged.                                                |
| `/marketplace/promotions[/:id]`       | intelligence pages                 | Promotion observation                    | Responsive list; no mutation.                                                                                        |
| `/marketplace/ads[/:id]`              | intelligence pages                 | Marketplace Ads observation              | Responsive list; no Ads financial mutation.                                                                          |
| `/marketplace/health`                 | intelligence pages                 | 15 canonical health groups and attention | Group/counter semantics unchanged; narrow cards and long values retain wrapping.                                     |
| `/marketplace/activity`               | intelligence pages                 | Immutable privileged action trail        | Responsive list; bounded filters/pagination and immutability unchanged.                                              |

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

| Platform                                                 | Required journeys                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iPhone, narrow and current large size                    | Shop discovery/search/sponsored disclosure; physical and digital product; save/cart/checkout/payment; order detail/delivery/problem; Seller dashboard/products continuation/editor keyboard/media/variants/shipping profile after page one/promotions/analytics/Ads; Creator Showcase add/reorder/remove, content tagging, analytics; LIVE product bag and checkout; safe areas, rotation policy, VoiceOver labels and dynamic text risks. |
| Android, narrow and current large size                   | Same critical buyer/seller/creator/LIVE journeys; system back; keyboard resize; TalkBack order; native Alerts; list end reach/refresh; long names and large BDAG; low-memory image fallback.                                                                                                                                                                                                                                               |
| Desktop browsers at 1440/1024/768/480/320 logical widths | Login/access denial; all ten Admin routes; menu open/close/navigation; all operational tables and pagination; detail links; dialog Tab/Shift+Tab/Escape/cancel/confirm/pending/error/retry; Health long counters; long seller/product/admin names; browser zoom at 200%.                                                                                                                                                                   |

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

## MKT-B8D-2R-C1 — Product Media Trust Closure

Baseline: `6fe70fb0261335fc9b3fa658708705c4e56a0982`, Build 22, remote migration `20260811033000_marketplace_production_hardening.sql`.

The Shop audit found that both the organic `ProductCard` and `SponsoredCard` substituted a random `picsum.photos` photograph when canonical product media was absent. Those external product-image fallbacks were removed. Both card families now render the same intentional neutral Marketplace surface with an image-unavailable icon and the truthful user-visible text `Imagen no disponible`; no remote fallback URL or fabricated product/store/sponsored photograph is used. Sponsored cards retain the visible `Patrocinado` disclosure.

The existing Product Detail gallery already used the same `Imagen no disponible` semantic and remains unchanged. Sponsored impression/click recording, campaign and product identifiers, source propagation, Ads finance, cart, checkout and all economic authority are unchanged.

A Marketplace production-surface scan found two remaining `picsum.photos` references in `app/creator/[id].tsx`; both are thumbnails for Creator video/content entries rather than product media. They were reported and intentionally left unchanged under the C1 scope prohibition on unrelated creator placeholders.

The B8D-2R proof now requires no random/external fallback provider in the Shop, explicit organic and sponsored missing-media branches, preserved sponsored disclosure, Product Detail consistency, unchanged Ads telemetry and unchanged cart/checkout contracts.

- Focused Marketplace UX/media regression: 31/31.
- Admin Web: 58/58; lint passed with zero warnings; production build passed (120 modules).
- Complete root Node suite: 740/740.
- Root TypeScript baseline: exactly 187 historical diagnostics and zero diagnostics in the C1 production file.
- Read-only B8D and inherited B8C auditors passed before and after C1 at remote migration `20260811033000`.
- B8B 8/8, Creator and Ads failure counters zero; payments/settlements healthy; escrow expected/actual 71/71; fixtures zero; failure hook absent.

No migration, Supabase push or EAS is part of C1; Build remains 22, no Ads/economic authority changed, and B8D-3 was not started.

## MKT-B8D-2R-F1 — Product Experience & Verified Reputation

Starting baseline: `e376a58f290e04f3bbac6a4d27c1f4cc2cf7e1e5`, branch `codex/mkt-a4b-premium-integration`, Build 22, remote migration `20260811033000_marketplace_production_hardening.sql`. Local/origin were identical, the worktree was clean, merge count since baseline was zero, and both inherited remote read-only auditors passed before implementation.

### Existing authority audit and reuse

No Marketplace product/store review table or review RPC existed. The canonical store model already contained `logo_asset_id` and `banner_asset_id`; the existing `set_marketplace_store_media(uuid,uuid,uuid)` authority already required the authenticated approved seller, editable store ownership, an owned ready/public image asset, and exact `store_logo` / `store_banner` purpose before binding it. The existing R2 media pipeline validates image MIME independently of filename and caps logo/banner uploads at 10 MB/25 MB. F1 reuses those columns, RPC and upload pipeline rather than introducing URLs or parallel branding authority.

Audited sources included `marketplace_stores`, `media_assets`, media links, create/finalize upload functions, store media RPC, orders, order items, fulfillment/delivery timestamps, sellers, profiles, product/store projections, seller settings, public product detail and the current gallery/purchase components.

### Forward review authority

Migration: `20260811034000_marketplace_verified_reviews_branding.sql`.

- Product reputation is one review per canonical `order_item_id`; seller/store reputation is separately one review per canonical delivered `order_id`.
- The client supplies only the eligible purchase key, integer rating and optional comment. `auth.uid()`, buyer ownership, product, seller, store and order identities are resolved and compared inside fixed-search-path SECURITY DEFINER RPCs.
- Eligibility requires canonical `delivered` plus a non-null `delivered_at`; cross-buyer and seller self-review paths are rejected.
- Rating is integer 1–5. Comments are trimmed, empty becomes NULL, and non-null text is capped at 1,000 characters.
- Exact-purchase retry/edit is an identity-checked upsert. Hidden moderation state is not reset by the buyer. Public reads include only `visible` reviews.
- Both tables are RLS-enabled and have no anon/authenticated direct table privileges. Public projections expose only display name, username, public avatar, rating/comment/timestamps and server-emitted verified-purchase state—no email, phone, shipping, payment or ledger identity.
- Product and seller aggregates are computed independently on the server. Product aggregate includes the 1→5 distribution. No-reviews average is NULL and the UI says `Sin reseñas todavía`.
- Review lists are newest-first keysets on `(created_at,id)`, default 20, hard maximum 50, NULL/0/51 rejected, with no OFFSET.
- Status is constrained to `visible|hidden`, allowing future privileged moderation to hide presentation without deleting purchase provenance. No client status mutation or new Admin moderation feature was added.
- `reconcile_marketplace_reviews()` validates purchase identities, delivery, seller/store identities and self-review absence; all five counters were zero in disposable proof.

### Store branding and public identity

`app/seller/store.tsx` now provides canonical logo and optional banner upload/replace with square/wide preview, pending locks, safe error/retry copy and refetch. It never accepts an arbitrary URL. A newly uploaded asset is cleaned only if binding fails; once the existing canonical binding succeeds it is not treated as an orphan. Product Detail and the new existing-authority public store route resolve branding only through safe server projections. Stores without branding render a neutral storefront icon, never random company imagery.

Disposable evidence bound an owned ready/public `store_logo`, rejected another user's logo and rejected a video asset for the logo slot. The inherited upload policy provides MIME and size enforcement; no service-role credential is present in mobile code.

### Premium product experience

`ProductMediaGallery` is now a horizontally paged native `FlatList`. Hero swipes update `selectedIndex`, externally selected thumbnails reposition the hero, hero selection re-centers the 66px thumbnail rail, and the `1 / N` counter follows the same state. Images expose `Toca para ampliar` and open a safe-area-aware black fullscreen modal with image-only horizontal paging, preserved selected source index, count and a 44×44 close action. Videos retain `expo-video` native controls and remain non-zoomable. Pinch/double-tap zoom was intentionally not added: no additional heavy gesture/animation dependency was warranted. Missing media remains the truthful `Imagen no disponible` state; no fake image/logo/review data exists.

Product Detail now places the real product rating below the title, renders the canonical store logo/name and distinct seller rating, links to `Ver tienda`, and shows bounded product/seller review tabs, verified-purchase labels, optional product distribution, eligibility-specific forms and pending/error/retry/empty states. Product and seller submissions are explicit and separate. The sticky quantity/cart/buy bar and exact selected-variant checkout continuation are unchanged.

All direct buyer-to-seller contact/chat actions were removed from Product Detail and Marketplace product/store commerce surfaces. The global OnSpace chat system, Creator DMs and order support/dispute routes were not changed. No product or store “verified” badge is emitted because the audited schema has no separate semantic that justifies that claim.

### Tests and safety evidence

- New static closure: verified authority derivation, RLS/grants, rating/comment bounds, keyset/privacy, distinct aggregates, deep mobile validation, paging/fullscreen synchronization, truthful media, branding reuse, removal of direct contact and unchanged checkout/economic paths.
- New disposable proof: anon denial; foreign-order denial; seller self-review denial; undelivered denial; 0/6/decimal/oversized-comment denial; valid product/store review; deterministic edit; separate aggregate accuracy; keyset page 1/page 2/terminal behavior; safe public keys; branding ownership/MIME; review reconciliation 5/5 zero; fixture residue zero.
- Full root Node: 747/747 passed after F1 additions.
- Admin Web: 58/58 passed; ESLint passed with zero warnings; Vite production build passed (120 modules).
- TypeScript: exactly 187 historical diagnostics and zero diagnostics in F1 changed production files.
- All inherited disposable Marketplace proofs passed, including B8S/B8A/B8B/B8C/B8D hardening, order/payment lifecycle, inventory/shipping/publication, held refund, post-settlement reversal, Promotions, Creator/multi-creator/LIVE, Ads finance/eligibility/finalization/delivery/events, runtime and fixture finalization. The known schema-only dump omission of global default ACL was handled exactly as in B8D-2: deployed migration 33000 was reapplied only inside the local disposable container before its inherited proof.

Remote deployment/post-audit evidence is recorded in the final F1 report after the linked dry-run and forward-only deployment. Build remains 22. Checkout, BDAG payment, escrow, settlement, refund/reversal, Creator commission, Promotions, Ads finance and Admin authority are unchanged. No EAS or mobile physical testing ran; B8D-3, B8D-4 and LIVE Battles were not started.

Postdeploy evidence: the linked dry-run reported exactly `20260811034000_marketplace_verified_reviews_branding.sql`, with no seed or role files, and the normal linked push applied only that migration. Remote latest is now exactly `20260811034000`. The read-only B8D auditor passed with 211/211 Marketplace SECURITY DEFINER functions fixed-path, zero broad Marketplace DML, zero null-limit risks, exact review grants, no authenticated direct review-table write, and review reconciliation 5/5 zero. The inherited B8C auditor also passed: B8B Admin Operations 8/8 zero; all Creator, Ads, payment, settlement and reversal failure counters zero; escrow expected/actual 71/71; fixtures zero; failure hook absent. Production contains no test review fixture.

## MKT-B8D-2R-F1-C1 — Exact Approved Mockup Visual Parity

Starting baseline: `15f697397772d67e86b418a689c596aa520e187f`, branch `codex/mkt-a4b-premium-integration`, Build 22, remote migration `20260811034000_marketplace_verified_reviews_branding.sql`. Local/origin were identical and clean; both remote read-only auditors passed before visual work. This closure changes only React Native layout, styling, accessibility composition, structural tests and this log. It creates no migration and does not change any review, branding, cart, checkout or economic service contract.

### Product mockup parity checklist

- [x] Header: visible `OnSpace / Marketplace` identity between the 44×44 back and share/favorite/cart controls.
- [x] Hero: rounded wide premium stage, native swipe, centered media, `Toca para ampliar`, fullscreen control, bounded previous/next arrows and `1 / N` pill.
- [x] Thumbnails: compact rail, purple selected border, bounded `+N / Ver más` continuation and synchronized selection.
- [x] Pagination: muted dots with the current item in purple.
- [x] Category, title, rating, price and shipping: continuous hierarchy with no enclosing generic commerce card; price is the dominant purple datum and shipping uses only canonical quote output.
- [x] Variants: the oversized `PERSONALIZA TU COMPRA` panel was removed. Options now use compact 44px chips; safely recognized color names use swatches, all other values remain textual, and unavailable/selected accessibility state is preserved.
- [x] Store card: canonical logo or neutral storefront, real store name, real seller aggregate, canonical product sales only when nonzero, store navigation and accurate purchase/shipping trust wording. No contact/chat CTA and no unsupported verification claim.
- [x] Reviews: full `Reseñas del producto` / `Valoración del vendedor` labels, real counts, compact aggregate, at most three initial verified-purchase snippets with canonical avatar or initials, separate product/seller actions and bounded continuation. The analytics-like 5→1 bars no longer dominate the product page.
- [x] Sticky purchase bar: one-row quantity + purple `Agregar al carrito` + secondary `Comprar ahora`, both with canonical unit price context; exact `handleAddToCart()` and `handleAddToCart(true)` wiring is unchanged.
- [x] Secure strip: `Compra segura en OnSpace Marketplace` in the sticky action surface.

### Store mockup parity checklist

- [x] Header: `Configuración de tienda` with `OnSpace Marketplace` identity and deterministic back behavior.
- [x] Logo: large circular real-logo/neutral preview, upload/replace action, pending/disabled semantics and explicit JPG/PNG/WebP, square-presentation, transparent-background and actual 10 MB guidance.
- [x] Information: premium icon rows for the three existing canonical fields—name, public slug and description. No illustrative category, hours or shipping-policy fields were invented.
- [x] Visual identity: full-width canonical banner preview, neutral absence state and existing secure replace action.
- [x] Reputation: `Cómo te ven los compradores`, public-store navigation and separate real product/seller aggregates; zero-data remains the honest `Sin reseñas verificadas todavía` state.
- [x] Save: full-width purple `Guardar cambios` action with exact pre-existing save authority plus subtle security footer.

### Intentional differences from the approved images

- `Producto verificado` and `Tienda verificada` are omitted because the effective schema has no distinct canonical verification signal; `published` or `approved seller` is not reinterpreted as verification.
- Illustrative fixed ratings, review names/photos, sales counts, delivery times and logos from the mockups are never rendered. Each region is conditional on real projections and uses truthful empty/fallback states.
- Store-setting tabs, category, shipping policy and business hours from the mockup are omitted because those settings do not have corresponding canonical store authority in this scope.
- Product trust wording is limited to existing protected checkout and canonical shipping-quote behavior; identity proof, real-time tracking and absolute payment claims are not invented.
- Pinch/double-tap zoom remains intentionally absent; the accepted full-screen image enlargement and paging use existing dependencies without adding a heavy gesture system.
- Embedded-browser render inspection could not be completed in this session because the local browser connection was unavailable. No physical-device or pixel-perfect claim is made; B8D-3 remains the place for 320/360/390/430 and device validation.

### Structural proof and responsive reasoning

`tests/marketplaceMktB8D2VisualParity.test.mjs` proves every major visible region, arrow boundary states, rail/dot synchronization, truthful shipping/store/review data, full review labels, separate review actions, exact purchase handlers, store configuration hierarchy, unchanged migration tip and absence of new financial authority. Existing F1 and B8D-2R tests remain active and were updated only where the authoritative mockup replaced old square-gallery/two-row-CTA proportions.

At 320/360 widths the gallery is bounded to viewport minus 32px, the 94px compact quantity stepper leaves flexible space for both CTA buttons, labels shrink within their own bounded copy containers, variant chips wrap, review actions wrap, and store fields/banner controls remain within their parent width. At 390/430 the same layout uses the regular quantity width and wider media rail. Store settings stack logo/actions/guidance below 700px and reproduce the wide mockup row at larger widths.

Build remains 22. Remote remains 34000. No SQL, Supabase push, Edge deployment, EAS or physical-device testing is part of C1. Review/branding authority and all Marketplace economics are unchanged. B8D-3 was not started.

### Final C1 verification

- F1/B8D-2R/parity closure: 27/27 passed; expanded Marketplace/B8S/B8A/B8B/B8C/B8D/product-detail focus: 99/99 passed.
- Admin Web: 58/58 passed; ESLint passed with zero warnings; production build passed with 120 modules.
- Complete root Node suite: 754/754 passed.
- TypeScript: exactly 187 historical diagnostics and zero diagnostics in C1 production files.
- Read-only B8D hardening and inherited B8C audits both passed at remote migration `20260811034000`; review reconciliation 5/5, B8B 8/8 and all Creator/Ads failure counters are zero, payments/settlements are healthy, escrow expected/actual is 71/71, fixtures are zero and the failure hook is absent.
- No migration, Supabase push, Edge deployment, EAS, physical-device test or economic-authority change occurred.

## MKT-B8D-2R-F1-C2 — Exact Store Settings Mockup Parity

Starting baseline: `86c5ddbd410bd458eb5dcd115626bd7b075adb1d`, branch `codex/mkt-a4b-premium-integration`, Build 22, remote migration `20260811034000_marketplace_verified_reviews_branding.sql`. Local/origin were identical and clean; the B8D hardening and inherited B8C read-only auditors passed before work.

This closure is confined to the Seller Store Settings presentation in `app/seller/store.tsx`, focused structural tests and this audit entry. The existing `updateStore`, `uploadMediaFromUri`, `setStoreMedia` and `fetchMarketplaceStoreReputation` boundaries remain authoritative and unchanged.

### Store mockup parity result

- Header: premium near-black/charcoal frame, deterministic shared Seller Center back behavior, exact `Configuración de tienda` title and `OnSpace Marketplace` subtitle, followed by a single active `Perfil de tienda` rail without inventing unsupported settings pages.
- Logo: elevated section, large circular canonical preview with purple gradient ring and edit affordance, responsive preview/action composition, gradient upload/replace CTA, pending/disabled accessibility state and a dedicated recommendations panel for JPG/PNG/WebP, square presentation, transparent background and the real 10 MB limit.
- Information: canonical name, public slug and description remain editable. Each is presented in an individual dark settings surface with icon, helper copy, purple focus border/glow, controlled input, accessible label and description character count.
- Visual identity: canonical banner upload/replace remains unchanged; presentation now uses an emphasized horizontal preview, real-image overlay and `Vista previa` badge, or an honest neutral empty state. The real 25 MB banner limit remains visible.
- Public reputation: product and seller aggregates always occupy separate premium cards, use only server-projected averages/counts, render honest no-review states, and stack only at the narrowest width.
- Save: the same canonical create/update operation is presented as a strong purple gradient action with idle, busy, success and error feedback plus the existing OnSpace security footer.
- Responsive reasoning: at 320px the 108px logo preview shares a bounded row with the flexible CTA, banner/reputation headings stack and rating cards stack; 360/390/430 retain side-by-side reputation cards and no horizontal scroll. At 760px the logo, actions and recommendations reproduce the wide mockup composition.

No verification badge, store category, business hours, shipping-policy editor or fake rating was introduced because no corresponding canonical authority exists. No SQL, migration, Supabase push, Edge deployment, EAS or economic-authority change is part of C2. Physical-device validation remains outside this task.

### C2 proof and render limitation

- Premium store/F1/B8D-focused tests: 106/106 passed; the dedicated store/reputation/navigation subset passed 21/21.
- Admin Web: 58/58 passed; ESLint passed with zero warnings; production build passed with 120 modules.
- Complete root Node suite: 756/756 passed.
- TypeScript: exactly 187 historical diagnostics and zero diagnostics in `app/seller/store.tsx`.
- Read-only B8D and inherited B8C auditors passed after C2 at remote migration `20260811034000`; review reconciliation 5/5, B8B 8/8 and all Creator/Ads failure counters are zero, settlements are healthy with current escrow expected/actual 70/70, fixtures are zero and the failure hook is absent.
- A local Expo Web render was attempted. The repository-wide bundle was blocked before route rendering by the pre-existing missing `@lottiefiles/dotlottie-react` dependency reached through the LIVE broadcast import graph. C2 did not install or alter that unrelated dependency, and no screenshot or pixel-perfect/device-validation claim is made.

## MKT-B8D-2R-F1-C3 — Low-Chrome Direct Store Editing

Starting baseline: `f2470b598b7506564cbc1947f0c5578230969c91`, branch `codex/mkt-a4b-premium-integration`, Build 22, remote migration `20260811034000_marketplace_verified_reviews_branding.sql`. Local/origin were identical and clean, and both inherited remote read-only auditors passed before the UI refinement.

This closure changes only `app/seller/store.tsx`, its structural visual-contract test and this appended audit record. The screen is now a low-chrome branding editor: the single inactive `Perfil de tienda` rail, rounded section containers, nested recommendation panel, per-field cards/icon boxes, ambient glow, large logo upload button and large banner upload button were removed. Typography, whitespace and quiet dividers now provide the section hierarchy.

### Direct-edit behavior

- Logo: the canonical logo or neutral placeholder is the 44px-accessible Pressable. Tapping the object invokes the unchanged `pickBranding("logo")` pipeline; the overlapping pencil carries pending feedback and the accessible label reflects upload/replace state. Guidance is compact inline copy with the existing JPG/PNG/WebP, square and 10 MB contract.
- Store information: name, public slug and description remain controlled `TextInput` fields backed by the unchanged `edit(...)` state path. Each value is directly editable, while a 44×44 pencil focuses the exact input through a ref. The active row uses only a subtle purple underline; no per-field background card remains. The public URL preview and description character count remain visible.
- Banner: the canonical cover or neutral empty surface is directly tappable and invokes the unchanged `pickBranding("banner")` pipeline. A 44×44 overlay pencil communicates edit/pending state; the old textual upload/replace button was removed.
- Reputation: the two compact product/seller aggregate cards remain because those metrics benefit from explicit grouping. Values continue to come only from `fetchMarketplaceStoreReputation`; no fake values were introduced.
- Save: `Guardar cambios` remains the sole dominant text CTA with the inherited idle, busy, success and error behavior. `createStore`, `updateStore`, `uploadMediaFromUri` and `setStoreMedia` authority are unchanged.

At 320/360/390/430 widths, sections stay within the bounded page padding, inputs flex around their fixed 44px edit targets, the logo scales from 108px to 136px, the banner remains width-bound, and reputation cards stack only below 360px. No horizontal ScrollView or additional nested surface was introduced.

Structural proof verifies all three controlled inputs and pencil focus wiring, direct logo/banner invocation, accessible labels, removal of large media buttons and the inactive rail, absence of background/radius chrome in `storeField` and `section`, continued reputation/save behavior, Build 22, migration 34000 and unchanged economic authority.

### C3 verification

- Store/B8D visual, UX, hardening and mobile-contract focus: 52/52 passed; the dedicated parity file passed 10/10.
- Admin Web: 58/58 passed; ESLint passed with zero warnings; production build passed with 120 modules.
- Complete root Node suite: 757/757 passed.
- TypeScript: exactly 187 historical diagnostics and zero diagnostics in `app/seller/store.tsx`.
- The read-only B8D hardening auditor passed at remote migration `20260811034000` with 211/211 Marketplace SECURITY DEFINER functions fixed-path, zero unsafe effective search paths, zero broad Marketplace DML and review reconciliation 5/5 zero.
- The inherited B8C read-only auditor passed: B8B 8/8 and all Creator, Ads, review, payment, settlement and reversal failure counters are zero; escrow expected/actual is currently 70/70; fixtures are zero and the failure hook is absent.

No migration, Supabase push, Edge deployment, EAS, physical-device test or economic-authority change occurred. Build remains 22, remote remains 34000 and B8D-3 was not started.

## MKT-B8D-2R-F1-C4 — Compact Store Identity Editor

Starting baseline: `3685e9d578c8e5db60563ae17cf8aba09fb51bdc`, branch `codex/mkt-a4b-premium-integration`, Build 22, remote migration `20260811034000_marketplace_verified_reviews_branding.sql`. Local/origin were identical and clean before this presentation-only refinement.

C4 preserves the accepted C3 direct-edit architecture while reducing first-viewport height and explanatory copy. `IDENTIDAD DE MARCA` now leads directly to a 114px logo on normal phones and 108px below 360px, followed by one `JPG · PNG · WebP · Máx. 10 MB` line. The visible `Toca para cambiar`, repeated logo title/description, repeated information title/body, and permanent square/transparent-background guidance were removed. The existing 44×44 logo pencil, direct Pressable and secure media pipeline remain intact.

Store information now reads as three editorial rows: subdued label, primary value, value-aligned 44×44 pencil and quiet divider. Name remains the highest-priority 17px semibold controlled input. Slug remains a one-line controlled input with a middle-ellipsized public URL preview, and description remains multiline with its character count. Focus changes only the underline and pencil color; the previous instructional helper paragraphs are gone.

### Public identifier audit and behavior

The effective `marketplace_stores.slug` contract is unique, lowercase ASCII kebab case. `create_marketplace_store` and `update_marketplace_store` both call the canonical `marketplace_normalize_slug`, enforce 3–80 characters and translate uniqueness violations to controlled store/slug errors. Seller ownership remains enforced by `update_marketplace_store`; C4 adds no write authority. Current public-store navigation uses `/store/[id]` with the immutable store UUID, while the slug remains the public-address field and may affect external/shared addresses when changed.

C4 does not automatically rewrite persisted values. A machine-generated `store-<long hex>` slug remains unchanged at rest and is visually constrained. Only when the seller focuses that field does the client stage a lowercase, accent-normalized, hyphenated suggestion derived from the current store name. The suggestion stays local until the existing `Guardar cambios` path calls `updateStore`; while focused, concise validation and the message `Esto cambiará la dirección pública de tu tienda al guardar.` appear when applicable. The server remains the final normalization, ownership and uniqueness authority.

Portada retains its direct-tap media action and 44×44 pencil while surrounding copy is reduced to `PORTADA`, the media surface and one format/25 MB line. Reputation keeps the two real aggregate cards and replaces the textual public-store link with an accessible 44×44 eye action. Save remains the sole strong text CTA with inherited idle, busy, success and error states.

Responsive source reasoning covers 320/360/390/430 widths: the logo stays within 108–114px, values flex beside fixed edit targets, the machine slug and URL cannot exceed their bounded row, the multiline description remains usable, the banner is width-bound and reputation still stacks below 360px. No horizontal scrolling or new card surface was introduced.

### C4 verification

- Store/B8D visual, UX, hardening and mobile-contract focus: 53/53 passed; the dedicated visual-parity file passed 11/11.
- Admin Web: 58/58 passed; ESLint passed with zero warnings; production build passed with 120 modules.
- Complete root Node suite: 758/758 passed.
- TypeScript: exactly 187 historical diagnostics and zero diagnostics in `app/seller/store.tsx`.
- The read-only B8D hardening auditor passed at remote migration `20260811034000`: 211/211 Marketplace SECURITY DEFINER functions fixed-path, zero effective unsafe paths, zero broad Marketplace DML and review reconciliation 5/5 zero.
- The inherited B8C auditor passed: B8B 8/8 and all Creator, Ads, review, payment, settlement and reversal failure counters are zero; escrow expected/actual is 70/70; fixtures are zero and the failure hook is absent.

No migration, Supabase push, Edge deployment, EAS, physical-device test or economic-authority change occurred. Build remains 22, remote remains 34000 and B8D-3 was not started.
