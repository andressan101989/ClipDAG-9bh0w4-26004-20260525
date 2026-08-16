import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const orders = read("app/seller/orders/index.tsx");
const orderDetail = read("app/seller/orders/[id].tsx");
const buyerOrderDetail = read("app/orders/[id].tsx");
const statusBadge = read("components/marketplace/OrderStatus.tsx");
const fulfillment = read("services/marketplaceFulfillmentService.ts");

test("seller order filters use one responsive horizontal rail instead of wrapping", () => {
  assert.match(orders, /useWindowDimensions/);
  assert.match(orders, /const \{ width \} = useWindowDimensions\(\)/);
  assert.match(orders, /COMPACT_BREAKPOINT\s*=\s*390/);
  assert.match(orders, /<ScrollView[\s\S]*?horizontal[\s\S]*?showsHorizontalScrollIndicator=\{false\}/);
  const filterStyles = orders.slice(orders.indexOf("filters: {"), orders.indexOf("chip: {"));
  assert.match(filterStyles, /flexDirection:\s*["']row["']/);
  assert.doesNotMatch(filterStyles, /flexWrap/);
  assert.match(orders, /chip:[\s\S]*?flexShrink:\s*0/);
});

test("filter statuses and full accessibility meanings remain canonical", () => {
  for (const [status, label] of [
    ["null", "Todos los pedidos"],
    ['"confirmed"', "Pedidos por preparar"],
    ['"processing"', "Pedidos en preparación"],
    ['"shipped"', "Pedidos enviados"],
    ['"delivered"', "Pedidos entregados"],
  ]) {
    assert(orders.includes(`accessibilityLabel: "${label}"`), label);
    assert(orders.includes(`value: ${status}`), status);
  }
  for (const icon of ["grid-view", "inventory-2", "pending-actions", "local-shipping", "task-alt"])
    assert(orders.includes(`icon: "${icon}"`), icon);
  assert.match(orders, /accessibilityState=\{\{ selected \}\}/);
  assert.match(orders, /setStatus\(filter\.value\)/);
});

test("compact widths shorten only presentation while retaining tap targets", () => {
  assert.match(orders, /const compact = width < COMPACT_BREAKPOINT/);
  assert.match(orders, /ICON_ONLY_STATUS_BREAKPOINT\s*=\s*350/);
  assert.match(orders, /compact \? filter\.compactLabel : filter\.label/);
  for (const label of ["Todos", "Prep.", "Proceso", "Envío", "OK"])
    assert(orders.includes(`compactLabel: "${label}"`), label);
  assert.match(orders, /chip:[\s\S]*?minHeight:\s*40/);
});

test("list order references use a deterministic bounded presentation", () => {
  const helper = orders.slice(
    orders.indexOf("const formatOrderNumberForList"),
    orders.indexOf("export default function SellerOrders"),
  );
  assert.match(helper, /orderNumber\.trim\(\)/);
  assert.match(helper, /normalized\.length <= 14/);
  assert.match(helper, /normalized\.slice\(0, 8\)/);
  assert.match(helper, /normalized\.slice\(-5\)/);
  const formatOrderNumberForList = (value) => {
    const normalized = value.trim();
    return normalized.length <= 14
      ? normalized
      : `${normalized.slice(0, 8)}…${normalized.slice(-5)}`;
  };
  assert.equal(formatOrderNumberForList("ORD-C01AD2D4D39C41AF"), "ORD-C01A…C41AF");
  assert.equal(formatOrderNumberForList("ORD-123"), "ORD-123");
});

test("canonical full order number remains in accessibility navigation and detail", () => {
  assert.match(orders, /accessibilityLabel=\{`Ver pedido \$\{item\.orderNumber\}`\}/);
  assert.match(orders, /router\.push\(`\/seller\/orders\/\$\{item\.id\}` as never\)/);
  assert.match(orders, /formatOrderNumberForList\(item\.orderNumber\)/);
  assert.match(orderDetail, /\{data\.order\.orderNumber\}/);
  assert.match(orderDetail, /fallbackRoute="\/seller\/orders"/);
});

test("order card content and status are protected against horizontal overflow", () => {
  assert.match(orders, /cardContent:\s*\{\s*flex:\s*1,\s*minWidth:\s*0/);
  assert.match(orders, /cardHeader:[\s\S]*?minWidth:\s*0/);
  assert.match(orders, /orderNumber:[\s\S]*?flex:\s*1[\s\S]*?minWidth:\s*0[\s\S]*?flexShrink:\s*1/);
  assert.match(orders, /statusSlot:\s*\{\s*flexShrink:\s*0\s*\}/);
  assert.match(orders, /style=\{s\.orderNumber\}\s+numberOfLines=\{1\}\s+ellipsizeMode="middle"/);
  assert.match(orders, /compact=\{compact\}/);
  assert.match(orders, /showLabel=\{!iconOnlyStatus\}/);
});

test("compact StatusBadge is optional and default callers stay backward compatible", () => {
  assert.match(statusBadge, /compact=false,showLabel=true/);
  assert.match(statusBadge, /compact\?:boolean;showLabel\?:boolean/);
  assert.match(statusBadge, /accessibilityLabel=\{label\}/);
  assert.match(statusBadge, /compact\?<MaterialIcons/);
  assert.match(statusBadge, /showLabel\?<Text/);
  assert.match(orderDetail, /<StatusBadge status=\{data\.order\.status\}\/>/);
  assert.match(buyerOrderDetail, /<StatusBadge status=\{data\.order\.status\}\s*\/>/);
});

test("real order loading pagination refresh and image fallback remain wired", () => {
  for (const token of [
    "fetchSellerOrders({",
    "status,",
    "limit: PAGE",
    'load("append")',
    "page.nextCursor",
    "RefreshControl",
    "firstItemImage",
    'name="inventory-2"',
  ])
    assert(orders.includes(token), token);
  assert.match(fulfillment, /fetch_my_marketplace_sales/);
  assert.match(fulfillment, /p_before_created_at/);
  assert.match(fulfillment, /p_before_id/);
  assert.match(orders, /No pudimos cargar los pedidos/);
  assert.match(orders, /Reintentar/);
  assert.doesNotMatch(orders, /orderNumber:\s*["']/);
});
