import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../services/marketplaceRuntimeValidation.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
const require = createRequire(import.meta.url);
vm.runInNewContext(javascript, { module, exports: module.exports, require, Error, Number, Date, Array, Object, RegExp });
const v = module.exports;
const id = "10000000-0000-4000-8000-000000000001";
const at = "2026-08-15T12:00:00.000Z";

test("Marketplace mobile validators accept canonical JSON primitives", () => {
  assert.equal(v.rpcUuid(id, "id"), id);
  assert.equal(v.rpcNonnegative(12.5, "money"), 12.5);
  assert.equal(v.rpcNonnegativeInteger(3, "quantity"), 3);
  assert.equal(v.rpcTimestamp(at, "created_at"), at);
  assert.equal(v.rpcEnum("active", ["active", "paused"], "status"), "active");
  assert.deepEqual(v.rpcArray([], "items"), []);
});

test("Marketplace mobile validators reject realistic malformed RPC JSON", () => {
  for (const operation of [
    () => v.rpcUuid("not-a-uuid", "id"),
    () => v.rpcNonnegative("12.5", "money"),
    () => v.rpcNonnegative(false, "money"),
    () => v.rpcNonnegativeInteger(1.2, "quantity"),
    () => v.rpcTimestamp("Invalid Date", "created_at"),
    () => v.rpcEnum("future_status", ["active", "paused"], "status"),
    () => v.rpcArray({}, "items"),
    () => v.rpcObject([], "receipt"),
  ]) assert.throws(operation, /marketplace_payload_invalid/);
});

test("Marketplace mobile cursor envelopes are bounded and structurally exact", () => {
  const page = v.rpcCursorPage({ items: [{ id }], page_size: 1, next_cursor: { id, created_at: at } }, "page");
  assert.equal(page.pageSize, 1);
  assert.throws(() => v.rpcCursorPage({ items: [], page_size: "0", next_cursor: null }, "page"), /marketplace_payload_invalid/);
  assert.throws(() => v.rpcCursorPage({ items: [], page_size: 101, next_cursor: null }, "page"), /marketplace_payload_invalid/);
  assert.throws(() => v.rpcCursorPage({ items: [], page_size: 0, next_cursor: [] }, "page"), /marketplace_payload_invalid/);
});
