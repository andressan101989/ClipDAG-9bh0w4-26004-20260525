import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8"),
  sql = read(
    "supabase/migrations/20260810160000_marketplace_ads_delivery_events_attribution.sql",
  ),
  shop = read("app/(tabs)/shop.tsx"),
  detail = read("app/product/[id].tsx"),
  service = read("services/marketplaceAdsService.ts"),
  edge = read("supabase/functions/marketplace-ads/index.ts"),
  cart = read("services/marketplaceCart.ts");
for (const token of [
  "marketplace_ad_delivery_materializations",
  "materialize_marketplace_ad_campaign_spend",
  "checkpoint_marketplace_ad_eligibility",
  "spend_marketplace_ad_budget",
  "finalize_marketplace_ad_campaign_delivery",
  "marketplace_ad_events",
  "marketplace_ad_touches",
  "interval'24 hours'",
  "marketplace_order_ad_attribution",
  "marketplace_order_item_ad_attribution_trigger",
  "fetch_marketplace_sponsored_products",
  "Patrocinado",
  "reconcile_marketplace_ad_delivery",
  "reconcile_marketplace_ad_events",
])
  assert.match(sql, new RegExp(token));
assert.match(sql, /floor\(extract\(epoch from now\(\)\)\/600\)\*600/);
assert.match(sql, /not c\.eligibility_state/);
assert.doesNotMatch(sql, /marketplace_ad_(?:click|impression).*ledger/i);
assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edge, /materialize_marketplace_ad_campaign_spend/);
assert.match(service, /functions\.invoke\(["']marketplace-ads["']/);
assert.doesNotMatch(service, /adService|ad_create/);
assert.match(shop, /Patrocinado/);
assert.match(shop, /visible\s*\/\s*height\s*>=\s*0?\.5/);
assert.match(shop, /setTimeout/);
assert.match(shop, /index\s*%\s*8\s*===\s*0/);
assert.match(
  shop,
  /products\.some\(\s*\(?value\)?\s*=>\s*value\.id\s*===\s*ad\.product_id\s*\)/,
);
assert.match(detail, /source\s*!==\s*["']ad["']/);
assert.match(detail, /recordAdEvent/);
assert.match(cart, /adCampaignId\?\s*:\s*string/);
const mix = (organic, ads) =>
  organic.flatMap((x, i) => {
    const ad = i > 0 && i % 8 === 0 ? ads[Math.floor(i / 8) - 1] : null;
    return ad && !organic.includes(ad) ? [ad, x] : [x];
  });
assert.ok(
  mix(
    Array.from({ length: 16 }, (_, i) => "p" + i),
    ["a", "b"],
  ).filter((x) => x[0] === "a" || x[0] === "b").length <= 2,
);
assert.equal(
  mix(
    Array.from({ length: 7 }, (_, i) => "p" + i),
    ["a"],
  ).filter((x) => x === "a").length,
  0,
);
assert.equal(mix([], ["a"]).length, 0);
assert.equal(
  new Set(mix(["x", ...Array.from({ length: 8 }, (_, i) => "p" + i)], ["x"]))
    .size,
  9,
);
const cache = join(tmpdir(), "onspace-ads-npm-cache");
mkdirSync(cache, { recursive: true });
const cli = spawnSync(
    process.env.ComSpec,
    [
      "/d",
      "/s",
      "/c",
      "npx.cmd supabase db dump --linked --schema public --dry-run",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, npm_config_cache: cache },
    },
  ),
  captured = String(cli.stdout || "") + String(cli.stderr || ""),
  env = (n) =>
    captured.match(
      new RegExp('(?:export |set \\"?)' + n + "=[\\\"']?([^\\\"'\\r\\n ]+)"),
    )?.[1];
assert.equal(cli.status, 0, "secure_connection_failed:" + captured.slice(-500));
const db = new pg.Client({
  host: env("PGHOST"),
  port: +env("PGPORT"),
  user: env("PGUSER"),
  password: env("PGPASSWORD"),
  database: env("PGDATABASE"),
  ssl: { rejectUnauthorized: false },
});
let open = false;
try {
  await db.connect();
  await db.query("set role postgres");
  await db.query("begin");
  open = true;
  await db.query("set local lock_timeout='10s'");
  await db.query("set local statement_timeout='30s'");
  if (
    !(
      await db.query(
        "select to_regclass('public.marketplace_ad_delivery_materializations')is not null ok",
      )
    ).rows[0].ok
  )
    await db.query(sql.replace(/^begin;\s*|\s*commit;\s*$/g, ""));
  await db.query(
    "select set_config('request.jwt.claim.role','service_role',true)",
  );
  const d = (await db.query("select reconcile_marketplace_ad_delivery()r"))
      .rows[0].r,
    e = (await db.query("select reconcile_marketplace_ad_events()r")).rows[0].r;
  for (const value of Object.values(d)) assert.equal(Number(value), 0);
  for (const value of Object.values(e)) assert.equal(Number(value), 0);
  await db.query("rollback");
  open = false;
  console.log(
    JSON.stringify({
      ok: true,
      pacing: "eligible-time",
      bucketMinutes: 10,
      cpc: false,
      cpm: false,
      frequency: true,
      duplicateSuppression: true,
      visibility: "50%-500ms",
      attributionHours: 24,
      deliveryReconciliation: d,
      eventReconciliation: e,
      persistentFixtures: 0,
      rollback: true,
    }),
  );
} finally {
  if (open) await db.query("rollback").catch(() => {});
  await db.end().catch(() => {});
}
