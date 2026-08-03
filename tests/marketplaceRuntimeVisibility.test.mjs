import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260803133000_fix_fixture_policy_runtime_permissions.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = await readFile(
  new URL("../services/marketplaceService.ts", import.meta.url),
  "utf8",
);
const shop = await readFile(
  new URL("../contexts/ShopContext.tsx", import.meta.url),
  "utf8",
);
const viewer = await readFile(
  new URL(
    "../components/live/commerce/LiveViewerCommerce.tsx",
    import.meta.url,
  ),
  "utf8",
);
const proof = await readFile(
  new URL("../scripts/prove-marketplace-client-runtime.mjs", import.meta.url),
  "utf8",
);

test("RLS helper gets only the required execution capability", () => {
  assert.match(
    migration,
    /grant execute on function fixture_ops\.is_fixture\(text, uuid\)\s+to anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on schema fixture_ops\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on table fixture_ops\.internal_test_fixture_registry/i,
  );
  assert.doesNotMatch(migration, /grant (?:usage|select).*fixture_ops/is);
});

test("runtime proof exercises caller roles, fixture exclusion and rollback", () => {
  assert.match(proof, /set local role/);
  assert.match(proof, /anon_visibility_invalid/);
  assert.match(proof, /buyer_visibility_invalid/);
  assert.match(proof, /seller_paused_hidden/);
  assert.match(proof, /fixture_product_visible/);
  assert.match(proof, /fixture_registry_accessible/);
  assert.match(proof, /runtime_rollback_counts_changed/);
  assert.match(proof, /postgres_42501/);
});

test("client reads preserve typed permission and transport failures", () => {
  assert.match(service, /marketplace_read_permission/);
  assert.match(service, /marketplace_read_transport/);
  assert.match(service, /postgresCode==='42501'/);
  assert.match(shop, /setProducts\(next\);setCatalogError\(null\)/);
  assert.doesNotMatch(shop, /catch\s*\{\s*setProducts\(\[\]\)/);
  assert.match(viewer, /error instanceof MarketplaceReadError/);
  assert.match(viewer, /No se creó ninguna reserva/);
});
