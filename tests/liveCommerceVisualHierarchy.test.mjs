import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [host, viewer, header, featured, summary, feed, rail, button] =
  await Promise.all([
    read("app/live/broadcast/[streamId].tsx"),
    read("app/live/watch/[streamId].tsx"),
    read("components/live/LiveSessionHeader.tsx"),
    read("components/live/commerce/LiveFeaturedProductCard.tsx"),
    read("components/live/commerce/LiveHostSalesSummary.tsx"),
    read("components/live/commerce/LiveHostPurchaseFeed.tsx"),
    read("components/live/shop/LiveProductRail.tsx"),
    read("components/live/commerce/LiveCommerceButton.tsx"),
  ]);

test("host and viewer share one compact accessible LIVE header", () => {
  assert.match(host, /<LiveSessionHeader/);
  assert.match(viewer, /<LiveSessionHeader/);
  assert.match(header, /EN VIVO/);
  assert.match(header, /viewerCount/);
  assert.match(header, /elapsed/);
  assert.match(header, /accessibilityLabel="Cerrar LIVE"/);
  assert.doesNotMatch(host, /Total recibido en regalos/);
});

test("host sales are collapsed by default with progressive disclosure", () => {
  assert.match(feed, /<LiveHostSalesSummary/);
  assert.doesNotMatch(feed, /<GlassSurface/);
  assert.match(summary, /useState\(false\)/);
  assert.match(summary, /Ventas \{stats\.ordersCount\}/);
  assert.match(summary, /<Modal[\s\S]*visible=\{expanded\}/);
  assert.match(summary, /creatorCommissionHeld/);
  assert.match(summary, /creatorCommissionReleased/);
  assert.match(summary, /onRequestClose/);
});

test("featured product card supports host and viewer actions and states", () => {
  assert.match(featured, /mode:\s*"host"\s*\|\s*"viewer"/);
  assert.match(featured, /\?\s*"Gestionar"\s*:\s*"Comprar"/);
  assert.match(featured, /numberOfLines=\{hostV4 \? 1 : 2\}/);
  assert.match(featured, /storeName\s*\|\|\s*product\.sellerName/);
  assert.match(featured, /ProductAvailabilityBadge/);
  assert.match(featured, /availableQuantity/);
  assert.match(featured, /ProductThumbnail/);
  assert.match(featured, /mode\s*===\s*"viewer"\s*&&\s*unavailable/);
  assert.match(rail, /<LiveFeaturedProductCard/);
});

test("viewer commerce is prominent without duplicating the social rail", () => {
  assert.match(viewer, /featuredLiveProduct \? \(/);
  assert.match(viewer, /onBuy=\{\(\) =>/);
  assert.match(viewer, /!featuredLiveProduct\?<LiveCommerceButton/);
  assert.match(rail, /Abrir bolsa con/);
  assert.match(featured, /Comprar/);
  assert.match(button, /textLabel/);
});

test("host controls retain technical handlers under the V4 interaction hierarchy", () => {
  for (const label of ["Fijar", "Ofertas", "Solicitudes", "Invitar", "Moderar"])
    assert.match(host, new RegExp(`>${label}<\\/Text>`));
  assert.match(host, /engagementRail/);
  assert.match(host, /sendReaction/);
  assert.match(host, /toggleMute/);
  assert.match(host, /switchCamera/);
  assert.match(host, /toggleCamera/);
  assert.match(host, /endBroadcast/);
  assert.match(host, /accessibilityLabel="Más controles"/);
  assert.match(host, /moreControlsVisible/);
  assert.match(host, /Agregar producto/);
  assert.match(featured, /Gestionar/);
});

test("visual redesign does not contain commerce mutation authority", () => {
  for (const source of [header, featured, summary, feed, rail, button]) {
    assert.doesNotMatch(
      source,
      /create_marketplace_payment|create_live_checkout_reservation|platform_fee|commission_bps|ledger_entries/,
    );
  }
  assert.match(summary, /BottomSheetSurface/);
  assert.match(summary, /accessibilityLabel/);
  assert.match(featured, /accessibilityState/);
});
