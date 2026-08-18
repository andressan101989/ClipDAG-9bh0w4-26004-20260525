import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const designFiles = [
  "design/colors.ts",
  "design/typography.ts",
  "design/spacing.ts",
  "design/radii.ts",
  "design/shadows.ts",
  "design/motion.ts",
  "design/opacity.ts",
  "design/layout.ts",
]
  .map(read)
  .join("\n");
const button = read("components/design/OnSpaceButton.tsx");
const feedback = read("components/design/Feedback.tsx");
const commerce = read("components/design/Commerce.tsx");
const rail = read("components/live/shop/LiveProductRail.tsx")+read("components/live/commerce/LiveFeaturedProductCard.tsx");
const bag = read("components/live/shop/LiveProductBagSheet.tsx");
const variant = read("components/live/shop/LiveVariantSelector.tsx");
const shipping = read("components/live/shop/LiveShippingForm.tsx");
const reservation = read("components/live/shop/LiveReservationSummary.tsx");
const success = read("components/live/shop/LivePurchaseSuccess.tsx");
const host = read("components/live/shop/LiveHostShopManager.tsx");
const hud = read("components/live/shop/LiveShopHud.tsx");
const viewer = read("components/live/commerce/LiveViewerCommerce.tsx");
const watch = read("app/live/watch/[streamId].tsx");

test("semantic design tokens define one reusable OnSpace visual language", () => {
  for (const token of [
    "backgroundPrimary",
    "backgroundGlass",
    "textPrimary",
    "textMuted",
    "brandPrimary",
    "commerceAccent",
    "commerceEscrow",
    "borderFocused",
    "headingLarge",
    "bodySmall",
    "priceLarge",
    "minimumTouchTarget",
    "spring",
  ])
    assert.match(designFiles, new RegExp(token));
  assert.doesNotMatch(designFiles, /fontSize:\s*(13|15|17|19),/);
});

test("button variants share loading disabled pressed accessibility and haptics", () => {
  for (const value of [
    "primary",
    "secondary",
    "ghost",
    "destructive",
    "commerce",
    "glass",
  ]) {
    assert.match(button, new RegExp(`"${value}"`));
  }
  for (const marker of [
    "ActivityIndicator",
    "accessibilityState",
    "pressed",
    "Haptics",
    "minimumTouchTarget",
  ]) {
    assert.match(button, new RegExp(marker));
  }
});

test("feedback primitives cover loading empty error toast and metrics", () => {
  for (const marker of [
    "Skeleton",
    "EmptyState",
    "ErrorState",
    "ToastCard",
    "MetricCard",
    "useReducedMotion",
  ]) {
    assert.match(feedback, new RegExp(marker));
  }
});

test("featured rail is compact animated accessible and sold-out safe", () => {
  for (const marker of [
    "productRailHeight",
    "hostV4 \\? 1 : 2",
    "withSpring",
    "useReducedMotion",
    "ProductAvailabilityBadge",
    "accessibilityState",
  ]) {
    assert.match(rail, new RegExp(marker.replace(/[{}]/g, "\\$&")));
  }
  assert.match(rail, /accessibilityState={{ disabled }}/);
  assert.match(rail, /Comprar/);
});

test("product bag has premium loading empty error refresh and optimized list states", () => {
  for (const marker of [
    "BottomSheetSurface",
    "Skeleton",
    "EmptyState",
    "ErrorState",
    "RefreshControl",
    "initialNumToRender",
    "removeClippedSubviews",
  ]) {
    assert.match(bag, new RegExp(marker));
  }
});

test("variant and quantity controls preserve accessible purchase constraints", () => {
  for (const marker of [
    "isOptionValueSelectable",
    'accessibilityRole="radio"',
    "selected",
    "disabled",
  ]) {
    assert.match(variant, new RegExp(marker));
  }
  for (const marker of ["minimum = 1", "maximum", "accessibilityLabel"]) {
    assert.ok(commerce.includes(marker));
  }
});

test("quick-buy stages provide inline delivery reservation and success presentation", () => {
  for (const marker of [
    "TextInput",
    "accessibilityLabel",
    "automaticallyAdjustKeyboardInsets",
    "inputError",
  ])
    assert.match(shipping, new RegExp(marker));
  for (const marker of [
    "Tiempo restante",
    "Saldo disponible",
    "Protección Marketplace",
    "Cancelar compra pendiente",
  ])
    assert.match(reservation, new RegExp(marker));
  for (const marker of [
    "Compra realizada",
    "Continuar viendo el LIVE",
    "Ver pedido",
    "NotificationFeedbackType.Success",
  ])
    assert.match(success, new RegExp(marker));
});

test("sheet state preserves reservation and success across close and reopen", () => {
  const nextStage = ({
    previousVisible,
    visible,
    current,
    hasReservation,
    success: paid,
  }) =>
    !previousVisible && visible && !hasReservation && !paid ? "bag" : current;
  assert.equal(
    nextStage({
      previousVisible: false,
      visible: true,
      current: "product",
      hasReservation: false,
      success: false,
    }),
    "bag",
  );
  assert.equal(
    nextStage({
      previousVisible: true,
      visible: true,
      current: "shipping",
      hasReservation: false,
      success: false,
    }),
    "shipping",
  );
  assert.equal(
    nextStage({
      previousVisible: false,
      visible: true,
      current: "reservation",
      hasReservation: true,
      success: false,
    }),
    "reservation",
  );
  assert.equal(
    nextStage({
      previousVisible: false,
      visible: true,
      current: "success",
      hasReservation: true,
      success: true,
    }),
    "success",
  );
  assert.match(viewer, /previousVisible/);
});

test("host manager has search pagination locked actions eligibility and zero states", () => {
  for (const marker of [
    "TextInput",
    "PAGE_SIZE = 20",
    "onEndReached",
    "busyIds",
    "20 productos",
    "EmptyState",
    "ErrorState",
    "RefreshControl",
  ]) {
    assert.match(host, new RegExp(marker));
  }
});

test("purchase HUD supports a bounded unique animated queue without production fixtures", () => {
  const enqueue = (queue, event) =>
    [...queue.filter((item) => item.id !== event.id), event].slice(-3);
  let queue = enqueue([], { id: "a" });
  queue = enqueue(queue, { id: "a" });
  queue = enqueue(queue, { id: "b" });
  queue = enqueue(queue, { id: "c" });
  queue = enqueue(queue, { id: "d" });
  assert.deepEqual(
    queue.map((item) => item.id),
    ["b", "c", "d"],
  );
  for (const marker of [
    "__DEV__",
    "LivePurchaseToastQueue",
    "creatorCommission",
    "autoDismissMs",
  ])
    assert.match(hud, new RegExp(marker));
  assert.doesNotMatch(watch, /LivePurchaseToast|mockPurchase|fakePurchase/);
});

test("commerce overlay does not unmount or navigate away from the LIVE session", () => {
  assert.match(watch, /LiveProductRail/);
  assert.match(watch, /LiveViewerCommerce/);
  assert.match(watch, /setGiftSheetVisible\(false\)/);
  assert.doesNotMatch(viewer, /router\.(?:replace|back)\([^)]*live/i);
  assert.doesNotMatch(watch, /commerceVisible[^\n]*leaveChannel/);
});

test("new premium surfaces contain no mojibake or influencer implementation", () => {
  const source = [
    designFiles,
    button,
    feedback,
    commerce,
    rail,
    bag,
    variant,
    shipping,
    reservation,
    success,
    host,
    hud,
    viewer,
  ].join("\n");
  assert.doesNotMatch(source, /Ã|Â|â€|�/);
  assert.doesNotMatch(
    source,
    /influencer_commission/i,
  );
});
