import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [host, rail, viewer] = await Promise.all([
  read("app/live/broadcast/[streamId].tsx"),
  read("components/live/shop/LiveProductRail.tsx"),
  read("app/live/watch/[streamId].tsx"),
]);

test("Host V4 derives one product-safe overlay boundary from product presence", () => {
  assert.match(host, /const productHeight = 88/);
  assert.match(host, /const productPlaceholderHeight = 44/);
  assert.match(
    host,
    /const productOverlayClearance = productBottom\s*\+ \(featuredLiveProduct \? productHeight : productPlaceholderHeight\)\s*\+ 12/,
  );
  assert.doesNotMatch(host, /actionPanelBottom/);
});

test("chat ends above a featured product and reclaims space without one", () => {
  assert.match(
    host,
    /const chatBottom = keyboardHeight > 0 \? composerClearance \+ 8 : productOverlayClearance/,
  );
  assert.match(host, /styles\.chatArea, \{ bottom: chatBottom, maxHeight: chatMaxHeight \}/);
  assert.match(host, /featuredLiveProduct \? productHeight : productPlaceholderHeight/);
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
  assert.doesNotMatch(viewer, /productOverlayClearance|REACTION_ANIMATION_DURATION_MS/);
});
