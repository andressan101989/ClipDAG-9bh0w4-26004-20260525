import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [host, header, rail, featured, giftOverlay, productManager] = await Promise.all([
  read("app/live/broadcast/[streamId].tsx"),
  read("components/live/LiveSessionHeader.tsx"),
  read("components/live/shop/LiveProductRail.tsx"),
  read("components/live/commerce/LiveFeaturedProductCard.tsx"),
  read("components/live/gifts/LiveGiftOverlay.tsx"),
  read("components/live/shop/LiveHostShopManager.tsx"),
]);

test("Host V4 is an explicit host-only responsive presentation", () => {
  assert.match(host, /<LiveSessionHeader[\s\S]*hostV4/);
  assert.match(host, /<LiveProductRail[\s\S]*mode="host"[\s\S]*hostV4/);
  assert.match(header, /hostV4\?: boolean/);
  assert.match(rail, /hostV4\?: boolean/);
  assert.match(host, /useWindowDimensions/);
});

test("V4 has one permanent Gift and one permanent Share entry", () => {
  assert.equal((host.match(/accessibilityLabel="Ver actividad de regalos del LIVE"/g) ?? []).length, 1);
  assert.equal((host.match(/accessibilityLabel="Compartir LIVE"/g) ?? []).length, 1);
  assert.match(host, /Share\.share/);
  assert.match(host, /hostActionPanel === 'gifts'/);
  assert.match(giftOverlay, /pointerEvents/);
  assert.doesNotMatch(host, />Regalos<\/Text>/);
});

test("engagement rail reuses reactions and chat without inventing aggregates", () => {
  for (const label of ["Like", "Chat", "Gift", "Share"])
    assert.match(host, new RegExp(`>${label}<\\/Text>`));
  assert.match(host, /<LiveBattleHostControls/);
  assert.match(host, /sendReaction\('\\u2764\\uFE0F'\)/);
  assert.match(host, /inputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(host, /2\.4K|Top 3 en Moda|134<\/Text>/);
});

test("hearts stay non-interactive behind the thin product rail", () => {
  assert.match(host, /pointerEvents="none"/);
  assert.match(host, /x: 0\.82 \+ Math\.random\(\) \* 0\.1/);
  assert.match(host, /floatingReaction:[\s\S]*zIndex: 8/);
  assert.match(rail, /hostV4Container:[\s\S]*minHeight: 88[\s\S]*zIndex: 15/);
  assert.match(featured, /hostV4Action:[\s\S]*position: "relative"/);
  assert.doesNotMatch(featured, /hostV4Action:[\s\S]*position: "absolute"/);
});

test("V4 exposes canonical host commerce and participant actions", () => {
  for (const label of ["Fijar", "Ofertas", "Solicitudes", "Invitar", "Moderar"])
    assert.match(host, new RegExp(`>${label}<\\/Text>`));
  assert.match(host, /setCommerceVisible\(true\)/);
  assert.match(productManager, /pinLiveProduct/);
  assert.match(productManager, /featureLiveProduct/);
  assert.match(host, /acceptJoinRequest\(participant\)/);
  assert.match(host, /rejectJoinRequest\(participant\)/);
  assert.match(host, /sendHostInviteToAudience\(participant\)/);
  assert.match(host, /removeCohost\(participant\)/);
  assert.match(host, /pendingRequests\.length > 99 \? '99\+'/);
});

test("technical controls, composer, and live authority remain wired", () => {
  assert.match(host, /onPress=\{toggleMute\}/);
  assert.match(host, /onPress=\{switchCamera\}/);
  assert.match(host, /onPress=\{toggleCamera\}/);
  assert.match(host, /onPress=\{endBroadcast\}/);
  assert.match(host, /placeholder="Escribe un mensaje\.\.\."/);
  assert.match(host, /onSubmitEditing=\{sendMessage\}/);
  assert.match(host, /LiveGiftOverlay/);
  assert.match(host, /LiveHostPurchaseFeed/);
  assert.match(host, /fetchLiveSessionProducts/);
});

test("V4 removes prohibited host affordances and keeps viewer bag gated", () => {
  assert.doesNotMatch(host, /¡Quiero vender!/);
  assert.match(rail, /mode === "viewer" \? <Pressable/);
  assert.doesNotMatch(rail, /mode === "host" \? <Pressable[\s\S]*styles\.bag/);
  const source = [host, header, rail, featured].join("\n");
  assert.doesNotMatch(source, /create table|alter table|create policy|service_role|atomic_ledger_transfer/i);
});
