import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [host, rail, viewer] = await Promise.all([
  read("app/live/broadcast/[streamId].tsx"),
  read("components/live/shop/LiveProductRail.tsx"),
  read("app/live/watch/[streamId].tsx"),
]);

test("Host V4 measures the complete outer product rail with an optional callback", () => {
  assert.match(rail, /onLayoutHeight\?: \(height: number\) => void/);
  assert.match(rail, /onLayout=\{onLayoutHeight \? event => onLayoutHeight\(event\.nativeEvent\.layout\.height\) : undefined\}/);
  assert.match(host, /const \[featuredProductMeasurement, setFeaturedProductMeasurement\] = useState/);
  assert.match(host, /Math\.abs\(current\.height - height\) < 1/);
  assert.match(host, /onLayoutHeight=\{handleProductRailLayout\}/);
});

test("measured product height replaces the nominal fallback in the safe boundary", () => {
  assert.match(host, /const PRODUCT_HEIGHT_FALLBACK = 88/);
  assert.match(host, /const PRODUCT_PLACEHOLDER_HEIGHT = 44/);
  assert.match(host, /const PRODUCT_OVERLAY_GAP = 12/);
  assert.match(
    host,
    /const effectiveProductHeight = featuredProductMeasurement\?\.productId === featuredProductId\s*\? featuredProductMeasurement\.height\s*:\s*PRODUCT_HEIGHT_FALLBACK/,
  );
  assert.match(
    host,
    /const productOverlayClearance = productBottom\s*\+ \(featuredLiveProduct \? effectiveProductHeight : PRODUCT_PLACEHOLDER_HEIGHT\)\s*\+ PRODUCT_OVERLAY_GAP/,
  );
  assert.doesNotMatch(host, /const productHeight = 88/);
  assert.doesNotMatch(host, /actionPanelBottom/);
});

test("measurements are product-scoped and a changed product remounts for a fresh layout", () => {
  assert.match(host, /const featuredProductId = featuredLiveProduct\?\.id \?\? null/);
  assert.match(host, /current\?\.productId === featuredProductId/);
  assert.match(host, /\{ productId: featuredProductId, height \}/);
  assert.match(host, /<LiveProductRail\s+key=\{featuredLiveProduct\.id\}/);
});

test("chat ends above a featured product and reclaims space without one", () => {
  assert.match(
    host,
    /const chatBottom = keyboardHeight > 0 \? composerClearance \+ 8 : productOverlayClearance/,
  );
  assert.match(host, /styles\.chatArea, \{ bottom: chatBottom, maxHeight: chatMaxHeight \}/);
  assert.match(host, /featuredLiveProduct \? effectiveProductHeight : PRODUCT_PLACEHOLDER_HEIGHT/);
});

test("every active host panel uses the product-safe boundary", () => {
  for (const style of [
    "requestPanel",
    "audiencePanel",
    "hostPanelFloating",
    "moderationPanel",
    "giftActivityPanel",
    "moreControls",
  ]) {
    assert.match(host, new RegExp(`styles\\.${style}[^\\n]*bottom:productOverlayClearance|styles\\.${style}[^\\n]*bottom: productOverlayClearance`));
  }
  assert.match(host, /styles\.cohostPanel[^\n]*bottom: productOverlayClearance \+/);
});

test("active panels render above the product while hearts remain behind it", () => {
  for (const style of ["requestPanel", "cohostPanel", "audiencePanel", "hostPanelFloating", "moderationPanel", "giftActivityPanel", "moreControls"])
    assert.match(host, new RegExp(`${style}:[\\s\\S]{0,260}zIndex:\\s*17`));
  assert.match(host, /floatingReaction:[\s\S]{0,120}zIndex: 8/);
  assert.match(rail, /hostV4Container:[\s\S]{0,160}zIndex: 15/);
});

test("floating hearts travel responsively beyond the viewport without blocking touches", () => {
  assert.match(host, /viewportHeight \* 0\.95/);
  assert.match(host, /viewportHeight - bottom \+ 64/);
  assert.match(host, /outputRange: \[0, -travelDistance\]/);
  assert.match(host, /viewportHeight=\{viewportHeight\}/);
  assert.match(host, /pointerEvents="none"/);
  assert.match(host, /REACTION_CLEANUP_DELAY_MS/);
});

test("the overlay polish remains explicitly Host-only", () => {
  assert.match(host, /<LiveProductRail[\s\S]*mode="host"[\s\S]*hostV4/);
  assert.match(viewer, /<LiveProductRail/);
  assert.doesNotMatch(viewer, /<LiveProductRail[\s\S]{0,600}hostV4/);
  assert.doesNotMatch(viewer, /onLayoutHeight/);
  assert.doesNotMatch(viewer, /productOverlayClearance|REACTION_ANIMATION_DURATION_MS/);
});
