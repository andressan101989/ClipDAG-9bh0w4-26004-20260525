import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [host, header, rail, featured, feed, hud, commerceButton] = await Promise.all([
  read("app/live/broadcast/[streamId].tsx"),
  read("components/live/LiveSessionHeader.tsx"),
  read("components/live/shop/LiveProductRail.tsx"),
  read("components/live/commerce/LiveFeaturedProductCard.tsx"),
  read("components/live/commerce/LiveHostPurchaseFeed.tsx"),
  read("components/live/shop/LiveShopHud.tsx"),
  read("components/live/commerce/LiveCommerceButton.tsx"),
]);

test("Host V3 keeps video dominant with a compact responsive overlay hierarchy", () => {
  assert.match(host, /RtcSurfaceView[\s\S]*style=\{styles\.videoStream\}/);
  assert.match(host, /useWindowDimensions/);
  assert.match(host, /hostV4/);
  assert.match(header, /hostRow/);
  assert.match(host, /engagementRail/);
  assert.match(host, /inputRef\.current\?\.focus\(\)/);
  assert.match(host, /keyboardHeight === 0/);
});

test("Host keeps V3 request, gift, and invitation authority under the V4 composition", () => {
  for (const label of ["Solicitudes", "Gift", "Invitar"])
    assert.match(host, new RegExp(label.replace("/", "\\/")));
  assert.match(host, /pendingRequests\.length > 0/);
  assert.match(host, /acceptJoinRequest\(participant\)/);
  assert.match(host, /rejectJoinRequest\(participant\)/);
  assert.match(host, /sendHostInviteToAudience\(participant\)/);
  assert.match(host, /toggleCohostMute\(participant\)/);
  assert.match(host, /toggleCohostMicLock\(participant\)/);
  assert.match(host, /setCohostTimer\(participant/);
  assert.match(host, /removeCohost\(participant\)/);
});

test("Host featured product is complete and has no lateral product counter box", () => {
  assert.match(host, /<LiveProductRail/);
  assert.match(featured, /ProductThumbnail/);
  assert.match(featured, /DESTACADO/);
  assert.match(featured, /ProductAvailabilityBadge/);
  assert.match(featured, /storeName\s*\|\|\s*product\.sellerName/);
  assert.match(featured, /availableQuantity/);
  assert.match(featured, /Gestionar/);
  assert.match(rail, /mode === "viewer" \? <Pressable/);
  assert.doesNotMatch(rail, /mode === "host" \? <Pressable[\s\S]*styles\.bag/);
});

test("sales and real purchase feedback retain the canonical LIVE commerce feed", () => {
  assert.match(host, /<LiveHostPurchaseFeed sessionId=\{streamId\}/);
  assert.match(feed, /fetchMyLivePurchaseEvents/);
  assert.match(feed, /fetchMyLiveShopStats/);
  assert.match(feed, /LivePurchaseToastQueue/);
  assert.match(hud, /autoDismissMs = 3400/);
  assert.match(hud, /creatorCommission/);
  assert.doesNotMatch(host, /70\.00 BDAG|Juguete sexual femenino|andresVen compró/);
});

test("compact controls preserve every production handler and the composer", () => {
  assert.match(commerceButton, /compact/);
  assert.match(host, /toggleMute/);
  assert.match(host, /switchCamera/);
  assert.match(host, /toggleCamera/);
  assert.match(host, /endBroadcast/);
  assert.match(host, /sendReaction/);
  assert.match(host, /onSubmitEditing=\{sendMessage\}/);
  assert.match(host, /onPress=\{sendMessage\}/);
  assert.match(host, /composerBottom = keyboardHeight > 0 \? keyboardHeight : insets\.bottom/);
});

test("Host V3 changes remain presentation-only", () => {
  const source = [host, header, rail, featured, feed, hud, commerceButton].join("\n");
  assert.doesNotMatch(source, /create table|alter table|create policy|service_role|ledger_entries|atomic_ledger_transfer/i);
  assert.match(host, /LiveGiftOverlay/);
  assert.match(host, /useLiveGiftAnimations/);
  assert.match(host, /LiveHostProductManager/);
});
