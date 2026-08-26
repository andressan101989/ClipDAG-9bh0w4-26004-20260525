import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [host, viewer] = await Promise.all([
  read("app/live/broadcast/[streamId].tsx"),
  read("app/live/watch/[streamId].tsx"),
]);

test("Host keeps the existing Agora remote UID video authority", () => {
  assert.match(host, /cohostRemoteUids\.map\(uid =>/);
  assert.match(host, /remoteUids\.filter\(uid => uid !== battleOpponentUid\)/);
  assert.match(host, /<RtcSurfaceView canvas=\{\{ uid \}\} style=\{styles\.remoteVideo\}/);
  assert.equal((host.match(/useAgoraEngine\(/g) ?? []).length, 1);
});

test("cohost preview is left anchored away from the right engagement rail", () => {
  assert.match(host, /remoteStrip:\s*\{[^\n]*left: 20/);
  assert.doesNotMatch(host, /remoteStrip:\s*\{[^\n]*right: 12/);
  assert.match(host, /engagementRail:\s*\{[\s\S]{0,100}right: 14/);
});

test("cohost preview bottom derives from the measured product-safe boundary", () => {
  assert.match(host, /const COHOST_PREVIEW_GAP = 12/);
  assert.match(host, /const cohostPreviewBottom = productOverlayClearance \+ COHOST_PREVIEW_GAP/);
  assert.match(host, /bottom: cohostPreviewBottom, maxHeight: cohostPreviewMaxHeight/);
  assert.doesNotMatch(host, /bottom: composerClearance \+ 150/);
});

test("product measurement remains the geometry authority", () => {
  assert.match(host, /featuredProductMeasurement\?\.productId === featuredProductId/);
  assert.match(host, /const productOverlayClearance = productBottom[\s\S]{0,180}PRODUCT_OVERLAY_GAP/);
  assert.match(host, /onLayoutHeight=\{handleProductRailLayout\}/);
});

test("active Host panels hide only the local preview surface", () => {
  assert.match(host, /const hostPanelOccupiesCohostPreview = hostActionPanel !== null \|\| moreControlsVisible/);
  assert.match(host, /cohostRemoteUids\.length > 0 && showCohostPreview/);
  assert.doesNotMatch(host, /hostPanelOccupiesCohostPreview[\s\S]{0,240}(?:leave\(|removeCohost\(|remoteUids\s*=)/);
});

test("preview stack stays between header and product without shrinking its tile", () => {
  assert.match(host, /viewportHeight - cohostPreviewBottom - insets\.top - COHOST_PREVIEW_TOP_CLEARANCE/);
  assert.match(host, /cohostPreviewMaxHeight >= COHOST_PREVIEW_HEIGHT/);
  assert.match(host, /remoteStrip:\s*\{[^\n]*overflow: 'hidden'/);
  assert.match(host, /remoteTile:\s*\{[^\n]*width: 140, height: 108/);
});

test("cohost preview layout remains Host-only", () => {
  assert.doesNotMatch(viewer, /cohostPreviewBottom|COHOST_PREVIEW_GAP|hostPanelOccupiesCohostPreview/);
  assert.doesNotMatch(viewer, /productOverlayClearance/);
});
