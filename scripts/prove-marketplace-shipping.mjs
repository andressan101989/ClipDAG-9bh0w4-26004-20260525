import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
const { Client } = pg,
  repo = process.cwd(),
  fail = (c) => {
    throw new Error(c);
  },
  assert = (v, c) => {
    if (!v) fail(c);
  },
  safe = (e) =>
    (e?.message ?? "").match(/marketplace_[a-z0-9_]+/i)?.[0] ??
    `postgres_${e?.code ?? "error"}`;
const cli = spawnSync(
  process.env.ComSpec,
  [
    "/d",
    "/s",
    "/c",
    "npx.cmd supabase db dump --linked --schema public --dry-run",
  ],
  { cwd: repo, encoding: "utf8", windowsHide: true },
);
if (cli.status !== 0) fail("shipping_secure_connection_failed");
const captured = `${cli.stdout ?? ""}${cli.stderr ?? ""}`,
  value = (n) =>
    captured.match(
      new RegExp(`(?:export |set \\"?)${n}=[\\"']?([^\\"'\\r\\n ]+)`),
    )?.[1],
  db = new Client({
    host: value("PGHOST"),
    port: Number(value("PGPORT")),
    user: value("PGUSER"),
    password: value("PGPASSWORD"),
    database: value("PGDATABASE"),
    ssl: { rejectUnauthorized: false },
  });
let open = false,
  stage = "connect";
const id = Object.fromEntries(
  [
    "seller",
    "buyer",
    "host",
    "store",
    "profile",
    "config",
    "product",
    "configProduct",
    "digital",
    "variant",
    "session",
    "offer",
    "pin",
  ].map((k) => [k, randomUUID()]),
);
const counts = `select(select count(*)::int from products)p,(select count(*)::int from marketplace_shipping_profiles)s,(select count(*)::int from marketplace_shipping_profile_regions)r,(select count(*)::int from marketplace_checkout_sessions)c,(select count(*)::int from marketplace_order_shipping_snapshots)n,(select count(*)::int from live_sessions)l,(select count(*)::int from live_session_products)lp`;
const claims = async (role, sub = "") =>
  db.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claim.sub',$3,true)",
    [JSON.stringify({ role, sub }), role, sub],
  );
async function code(run, expected) {
  await db.query("savepoint expected");
  try {
    await run();
    fail(`expected_${expected}`);
  } catch (e) {
    await db.query("rollback to savepoint expected");
    assert(String(e.message).includes(expected), `unexpected_${expected}`);
  } finally {
    await db.query("release savepoint expected").catch(() => {});
  }
}
try {
  await db.connect();
  await db.query("set role postgres");
  const before = (await db.query(counts)).rows[0];
  await db.query("begin");
  open = true;
  await claims("service_role");
  stage = "fixtures";
  for (const [u, label] of [
    [id.seller, "seller"],
    [id.buyer, "buyer"],
    [id.host, "host"],
  ]) {
    await db.query(
      "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())",
      [u, `shipping-${label}-${randomUUID()}@synthetic.local`],
    );
    await db.query(
      "insert into user_profiles(id,username,display_name)values($1,$2,$3)",
      [
        u,
        `shipping_${label}_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
        label,
      ],
    );
  }
  await db.query(
    "insert into marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Shipping Seller',now())",
    [id.seller],
  );
  await db.query(
    "insert into marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'Shipping Store',$3,'active')",
    [id.store, id.seller, `shipping-${randomUUID()}`],
  );
  await db.query(
    "insert into marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary,configuration_status)values($1,$2,$3,'Explicit',1,2,'US','Returns', 'configuration_required'),($4,$2,$3,'Needs config',1,2,'US','Returns','configuration_required')",
    [id.profile, id.seller, id.store, id.config],
  );
  await db.query(
    "insert into marketplace_shipping_profile_regions(profile_id,country_code,region_code,shipping_price,transit_days_min,transit_days_max)values($1,'US',null,.25,2,7),($1,'US','FL',.5,1,3)",
    [id.profile],
  );
  await db.query(
    "insert into products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,shipping_profile_id)values($1,$2,'Explicit product','Proof',1,'BDAG','physical',5,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$4),($5,$2,'Config product','Proof',1,'BDAG','physical',5,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now(),$6),($7,$2,'Digital product','Proof',1,'BDAG','digital',5,'active',$3,'10000000-0000-4000-8000-000000000002','digital','approved',now(),null)",
    [
      id.product,
      id.seller,
      id.store,
      id.profile,
      id.configProduct,
      id.config,
      id.digital,
    ],
  );
  const sku = `SHIP-${randomUUID().toUpperCase()}`;
  await db.query(
    "insert into marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',1,'active',true,'')",
    [id.variant, id.product, id.store, id.seller, sku],
  );
  await db.query(
    "insert into marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,5,0)",
    [id.variant],
  );
  stage = "profile_recovery";
  const profileCount = (
      await db.query(
        "select count(*)::int n from marketplace_shipping_profiles where id=$1",
        [id.config],
      )
    ).rows[0].n,
    profileArgs = [id.config, id.store, "Needs config", 1, 2, "US", "Returns"];
  await claims("authenticated", id.seller);
  const restored = (
    await db.query(
      "select upsert_my_marketplace_shipping_profile($1,$2,$3,$4,$5,$6,$7,jsonb_build_array(jsonb_build_object('country_code','US','region_code','FL','shipping_price',.4,'transit_days_min',2,'transit_days_max',4)))id",
      profileArgs,
    )
  ).rows[0].id;
  assert(restored === id.config, "profile_id_changed");
  assert(
    (
      await db.query(
        "select configuration_status s from marketplace_shipping_profiles where id=$1",
        [id.config],
      )
    ).rows[0].s === "explicit_ready",
    "profile_not_ready",
  );
  assert(
    (
      await db.query("select quote_marketplace_shipping($1,'US','FL',1)q", [
        id.configProduct,
      ])
    ).rows[0].q.eligible,
    "profile_quote_not_ready",
  );
  const cleared = (
    await db.query(
      "select upsert_my_marketplace_shipping_profile($1,$2,$3,$4,$5,$6,$7,'[]'::jsonb)id",
      profileArgs,
    )
  ).rows[0].id;
  assert(
    cleared === id.config &&
      profileCount ===
        (
          await db.query(
            "select count(*)::int n from marketplace_shipping_profiles where id=$1",
            [id.config],
          )
        ).rows[0].n,
    "duplicate_profile",
  );
  assert(
    (
      await db.query(
        "select configuration_status s from marketplace_shipping_profiles where id=$1",
        [id.config],
      )
    ).rows[0].s === "configuration_required",
    "profile_not_regressed",
  );
  assert(
    (
      await db.query("select shipping_profile_id p from products where id=$1", [
        id.configProduct,
      ])
    ).rows[0].p === id.config,
    "product_detached",
  );
  await code(
    () =>
      db.query("select quote_marketplace_shipping($1,'US','FL',1)", [
        id.configProduct,
      ]),
    "marketplace_shipping_configuration_required",
  );
  const readded = (
    await db.query(
      "select upsert_my_marketplace_shipping_profile($1,$2,$3,$4,$5,$6,$7,jsonb_build_array(jsonb_build_object('country_code','US','region_code','FL','shipping_price',.4,'transit_days_min',2,'transit_days_max',4)))id",
      profileArgs,
    )
  ).rows[0].id;
  assert(
    readded === id.config &&
      (
        await db.query(
          "select configuration_status s from marketplace_shipping_profiles where id=$1",
          [id.config],
        )
      ).rows[0].s === "explicit_ready",
    "profile_not_restored",
  );
  stage = "status_preservation";
  await db.query("savepoint status_preservation");
  const existingRule = (await db.query("select id from marketplace_shipping_profile_regions where profile_id=$1 and country_code='US'and region_code='FL'", [id.config])).rows[0].id;
  const pausedRule = randomUUID(), otherProfile = randomUUID(), foreignRule = randomUUID();
  await claims("service_role");
  await db.query("insert into marketplace_shipping_profile_regions(id,profile_id,country_code,region_code,shipping_price,transit_days_min,transit_days_max,status)values($1,$2,'US','CA',.6,3,5,'paused')", [pausedRule, id.config]);
  await db.query("insert into marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary,configuration_status)values($1,$2,$3,'Other',1,2,'US','Returns','explicit_ready')", [otherProfile, id.seller, id.store]);
  await db.query("insert into marketplace_shipping_profile_regions(id,profile_id,country_code,region_code,shipping_price,transit_days_min,transit_days_max)values($1,$2,'US','TX',1,2,4)", [foreignRule, otherProfile]);
  await claims("authenticated", id.seller);
  const statusRules = [
    { id: existingRule, status: "active", country_code: "US", region_code: "fl", shipping_price: 0.45, transit_days_min: 2, transit_days_max: 4 },
    { id: pausedRule, status: "paused", country_code: "CA", region_code: "on", shipping_price: 0.6, transit_days_min: 3, transit_days_max: 5 },
    { id: null, status: "active", country_code: "GB", region_code: null, shipping_price: 0.7, transit_days_min: 4, transit_days_max: 8 },
  ];
  const saveStatus = (ships, rules, name = "Status edit") => db.query(
    "select upsert_my_marketplace_shipping_profile($1,$2,$3,1,2,$4,$5,$6::jsonb)",
    [id.config, id.store, name, ships, "Returns", JSON.stringify(rules)],
  );
  await saveStatus("US", statusRules);
  const savedRules = (await db.query("select id,country_code,region_code,status,shipping_price,transit_days_min,transit_days_max from marketplace_shipping_profile_regions where profile_id=$1", [id.config])).rows;
  assert(savedRules.some(x => x.id === existingRule && x.region_code === "FL" && x.status === "active"), "active_rule_not_preserved");
  assert(savedRules.some(x => x.id === pausedRule && x.country_code === "CA" && x.region_code === "ON" && x.status === "paused"), "paused_rule_not_preserved");
  assert(savedRules.some(x => x.country_code === "GB" && x.region_code === null && x.status === "active"), "country_wide_rule_failed");
  const stableRules = savedRules.map(x => ({ id: x.id, status: x.status, country_code: x.country_code, region_code: x.region_code, shipping_price: Number(x.shipping_price), transit_days_min: x.transit_days_min, transit_days_max: x.transit_days_max }));
  await code(() => saveStatus("ZZ", stableRules), "marketplace_shipping_country_invalid");
  await code(() => saveStatus("US", [{ id: null, country_code: "ZZ", region_code: null, shipping_price: 1, transit_days_min: 1, transit_days_max: 2 }]), "marketplace_shipping_country_invalid");
  await code(() => saveStatus("US", [{ id: null, country_code: "US", region_code: "ZZ", shipping_price: 1, transit_days_min: 1, transit_days_max: 2 }]), "marketplace_shipping_region_invalid");
  await code(() => saveStatus("US", [{ id: null, country_code: "CA", region_code: "zz", shipping_price: 1, transit_days_min: 1, transit_days_max: 2 }]), "marketplace_shipping_region_invalid");
  await code(() => saveStatus("US", [{ id: foreignRule, country_code: "US", region_code: "TX", shipping_price: 1, transit_days_min: 1, transit_days_max: 2 }]), "marketplace_shipping_rule_not_owned");
  await claims("service_role");
  await db.query("update marketplace_shipping_profiles set status='paused'where id=$1", [id.config]);
  await claims("authenticated", id.seller);
  await saveStatus("US", stableRules, "Paused edit");
  assert((await db.query("select status from marketplace_shipping_profiles where id=$1", [id.config])).rows[0].status === "paused", "paused_profile_reactivated");
  await code(() => db.query("select quote_marketplace_shipping($1,'US','FL',1)", [id.configProduct]), "marketplace_shipping_profile_inactive");
  await saveStatus("US", [], "Paused empty");
  const emptyStatus = (await db.query("select status,configuration_status from marketplace_shipping_profiles where id=$1", [id.config])).rows[0];
  assert(emptyStatus.status === "paused" && emptyStatus.configuration_status === "configuration_required", "zero_rule_status_regression");
  assert((await db.query("select shipping_profile_id from products where id=$1", [id.configProduct])).rows[0].shipping_profile_id === id.config, "product_detached_status");
  await saveStatus("US", [{ id: null, country_code: "GB", region_code: null, shipping_price: 1, transit_days_min: 2, transit_days_max: 4 }], "Paused restored");
  const readyStatus = (await db.query("select status,configuration_status from marketplace_shipping_profiles where id=$1", [id.config])).rows[0];
  assert(readyStatus.status === "paused" && readyStatus.configuration_status === "explicit_ready", "explicit_ready_status_restore_failed");
  await db.query("rollback to savepoint status_preservation");
  await db.query("release savepoint status_preservation");
  stage = "quotes";
  const exact = (
      await db.query("select quote_marketplace_shipping($1,' us ',' fl ',1)q", [
        id.product,
      ])
    ).rows[0].q,
    country = (
      await db.query("select quote_marketplace_shipping($1,'US','TX',2)q", [
        id.product,
      ])
    ).rows[0].q;
  assert(
    Number(exact.shipping_amount) === 0.5 && exact.region_code === "FL",
    "exact_rule_failed",
  );
  assert(
    Number(country.shipping_amount) === 0.25 &&
      country.quantity_policy === "per_order_profile",
    "country_rule_failed",
  );
  await code(
    () =>
      db.query("select quote_marketplace_shipping($1,'CA','ON',1)", [
        id.product,
      ]),
    "marketplace_shipping_destination_unsupported",
  );
  await code(
    () =>
      db.query("select quote_marketplace_shipping($1,'US','ZZ',1)", [
        id.product,
      ]),
    "marketplace_shipping_region_invalid",
  );
  await code(
    () =>
      db.query("select quote_marketplace_shipping($1,'US','FL',1)", [
        id.configProduct,
      ]),
    "marketplace_shipping_configuration_required",
  );
  const digital = (
    await db.query("select quote_marketplace_shipping($1,'US','FL',1)q", [
      id.digital,
    ])
  ).rows[0].q;
  assert(
    Number(digital.shipping_amount) === 0 &&
      digital.code === "marketplace_shipping_not_required",
    "digital_failed",
  );
  stage = "stale";
  await db.query(
    "update marketplace_shipping_profile_regions set shipping_price=.75 where profile_id=$1 and region_code='FL'",
    [id.profile],
  );
  const revised = (
    await db.query("select quote_marketplace_shipping($1,'US','FL',1)q", [
      id.product,
    ])
  ).rows[0].q;
  assert(
    revised.quote_fingerprint !== exact.quote_fingerprint &&
      Number(revised.shipping_amount) === 0.75,
    "stale_quote_not_replaced",
  );
  stage = "checkout";
  await claims("authenticated", id.buyer);
  const address =
      "jsonb_build_object('recipient_name','Shipping Proof','line1','Proof','city','Miami','region','FL','postal_code','33101','country','US')",
    checkoutKey = randomUUID();
  const checkout = (
    await db.query(
      `select create_marketplace_checkout_reservation(jsonb_build_array(jsonb_build_object('variant_id',$1::uuid,'quantity',1)),${address},$2)q`,
      [id.variant, checkoutKey],
    )
  ).rows[0].q;
  assert(checkout.checkout.status === "pending_payment", "checkout_failed");
  const snap = (
    await db.query(
      "select shipping_price,matched_rule_id,quote_fingerprint from marketplace_order_shipping_snapshots where checkout_id=$1",
      [checkout.checkout.id],
    )
  ).rows[0];
  assert(
    Number(snap.shipping_price) === 0.75 &&
      snap.matched_rule_id &&
      snap.quote_fingerprint,
    "snapshot_failed",
  );
  await db.query(
    "update marketplace_shipping_profile_regions set shipping_price=1 where profile_id=$1 and region_code='FL'",
    [id.profile],
  );
  await claims("service_role");
  assert(
    (
      await db.query(
        "select validate_marketplace_checkout_shipping_snapshot($1)q",
        [checkout.checkout.id],
      )
    ).rows[0].q.valid,
    "frozen_A_rejected",
  );
  await claims("authenticated", id.buyer);
  await db.query("select cancel_marketplace_checkout_reservation($1)", [
    checkout.checkout.id,
  ]);
  const next = (
    await db.query(
      `select create_marketplace_checkout_reservation(jsonb_build_array(jsonb_build_object('variant_id',$1::uuid,'quantity',1)),${address},$2)q`,
      [id.variant, randomUUID()],
    )
  ).rows[0].q;
  assert(Number(next.checkout.shipping_amount) === 1, "new_reservation_not_B");
  await db.query("select cancel_marketplace_checkout_reservation($1)", [
    next.checkout.id,
  ]);
  stage = "snapshot_guards";
  const exp = (
    await db.query(
      `select create_marketplace_checkout_reservation(jsonb_build_array(jsonb_build_object('variant_id',$1::uuid,'quantity',1)),${address},$2)q`,
      [id.variant, randomUUID()],
    )
  ).rows[0].q;
  await db.query(
    "update marketplace_checkout_sessions set created_at=now()-interval '20 minutes',expires_at=now()-interval '1 second' where id=$1",
    [exp.checkout.id],
  );
  await claims("service_role");
  await code(
    () =>
      db.query("select validate_marketplace_checkout_shipping_snapshot($1)", [
        exp.checkout.id,
      ]),
    "marketplace_checkout_expired",
  );
  await claims("authenticated", id.buyer);
  await db.query("select expire_marketplace_checkout_reservations(100)");
  const corrupt = (
    await db.query(
      `select create_marketplace_checkout_reservation(jsonb_build_array(jsonb_build_object('variant_id',$1::uuid,'quantity',1)),${address},$2)q`,
      [id.variant, randomUUID()],
    )
  ).rows[0].q;
  await db.query("savepoint corrupt");
  await db.query(
    "delete from marketplace_order_shipping_snapshots where checkout_id=$1",
    [corrupt.checkout.id],
  );
  await claims("service_role");
  await code(
    () =>
      db.query("select validate_marketplace_checkout_shipping_snapshot($1)", [
        corrupt.checkout.id,
      ]),
    "marketplace_shipping_quote_stale",
  );
  await db.query("rollback to savepoint corrupt");
  await claims("authenticated", id.buyer);
  await db.query("select cancel_marketplace_checkout_reservation($1)", [
    corrupt.checkout.id,
  ]);
  stage = "live_fixture";
  await claims("service_role");
  await db.query(
    "insert into marketplace_live_affiliate_offers(id,seller_id,store_id,product_id,offer_scope,commission_bps,status)values($1,$2,$3,$4,'public_creator',500,'active')",
    [id.offer, id.seller, id.store, id.product],
  );
  await db.query(
    "insert into live_sessions(id,host_id,title,status)values($1,$2,'Shipping LIVE','live')",
    [id.session, id.host],
  );
  await db.query(
    "insert into live_session_products(id,session_id,host_id,seller_id,store_id,product_id,featured_variant_id,status,is_featured,position,commerce_mode,creator_commission_bps,affiliate_offer_id)values($1,$2,$3,$4,$5,$6,$7,'active',true,0,'affiliate_product',500,$8)",
    [
      id.pin,
      id.session,
      id.host,
      id.seller,
      id.store,
      id.product,
      id.variant,
      id.offer,
    ],
  );
  await claims("authenticated", id.buyer);
  const liveKey = randomUUID(),
    live = (
      await db.query(
        `select create_live_marketplace_checkout_reservation($1,$2,$3,1,${address},$4)q`,
        [id.session, id.pin, id.variant, liveKey],
      )
    ).rows[0].q,
    liveRetry = (
      await db.query(
        `select create_live_marketplace_checkout_reservation($1,$2,$3,1,${address},$4)q`,
        [id.session, id.pin, id.variant, liveKey],
      )
    ).rows[0].q;
  assert(live.checkout.id === liveRetry.checkout.id, "live_idempotency");
  const source = (
    await db.query(
      "select live_host_id from marketplace_live_order_sources where checkout_id=$1",
      [live.checkout.id],
    )
  ).rows[0];
  assert(source.live_host_id === id.host, "creator_attribution_changed");
  assert(
    (
      await db.query(
        "select count(*)::int n from marketplace_inventory_reservations where checkout_id=$1",
        [live.checkout.id],
      )
    ).rows[0].n === 1,
    "duplicate_live_inventory",
  );
  await db.query("select cancel_marketplace_checkout_reservation($1)", [
    live.checkout.id,
  ]);
  await code(
    () =>
      db.query(
        "select create_live_marketplace_checkout_reservation($1,$2,$3,1,jsonb_build_object('recipient_name','Proof','line1','Proof','city','Toronto','region','ON','postal_code','M5V','country','CA'),$4)",
        [id.session, id.pin, id.variant, randomUUID()],
      ),
    "marketplace_shipping_destination_unsupported",
  );
  await db.query(
    "update live_sessions set status='ended',ended_at=now() where id=$1",
    [id.session],
  );
  await code(
    () =>
      db.query(
        `select create_live_marketplace_checkout_reservation($1,$2,$3,1,${address},$4)`,
        [id.session, id.pin, id.variant, randomUUID()],
      ),
    "live_commerce_live_ended",
  );
  await db.query(
    "update live_sessions set status='live',ended_at=null where id=$1",
    [id.session],
  );
  await claims("authenticated", id.seller);
  await code(
    () =>
      db.query(
        `select create_live_marketplace_checkout_reservation($1,$2,$3,1,${address},$4)`,
        [id.session, id.pin, id.variant, randomUUID()],
      ),
    "marketplace_own_product_forbidden",
  );
  assert(
    (
      await db.query(
        "select count(*)::int n from marketplace_payments where checkout_id in(select id from marketplace_checkout_sessions where buyer_id in($1,$2))",
        [id.buyer, id.seller],
      )
    ).rows[0].n === 0,
    "payment_created",
  );
  await db.query("rollback");
  open = false;
  const after = (await db.query(counts)).rows[0];
  assert(JSON.stringify(before) === JSON.stringify(after), "rollback_changed");
  const recon = (
      await db.query(
        "select reconcile_marketplace_payments()p,reconcile_marketplace_settlements()s,reconcile_marketplace_live_commissions()c",
      )
    ).rows[0],
    zero = (x) =>
      Object.entries(x).every(
        ([k, v]) =>
          ["escrow_actual_balance", "escrow_expected_held_total"].includes(k) ||
          typeof v !== "number" ||
          v === 0,
      );
  assert(
    zero(recon.p) && zero(recon.s) && zero(recon.c),
    "reconciliation_nonzero",
  );
  const realShippingStatuses = (
    await db.query(
      "select(select count(*)::int from marketplace_shipping_profiles where status='active')active_profiles,(select count(*)::int from marketplace_shipping_profiles where status='paused')paused_profiles,(select count(*)::int from marketplace_shipping_profile_regions where status='active')active_rules,(select count(*)::int from marketplace_shipping_profile_regions where status='paused')paused_rules",
    )
  ).rows[0];
  console.log(
    JSON.stringify(
      {
        matching: { exact_region: true, country_wide: true, precedence: true },
        profile_recovery: {
          same_profile: true,
          explicit_ready: true,
          configuration_required_after_last_rule: true,
        },
        status_preservation: {
          stable_rule_ids: true,
          active_rule: true,
          paused_rule: true,
          paused_profile: true,
          new_rule_defaults_active: true,
          foreign_rule_denied: true,
          country_validation: true,
          us_ca_normalization: true,
          country_wide_rule: true,
        },
        real_shipping_statuses: realShippingStatuses,
        blocked: { country: true, region: true, configuration: true },
        digital: { zero_shipping: true },
        reservation: {
          frozen_A_after_profile_B: true,
          new_reservation_B: true,
          expired_blocked: true,
          corrupt_snapshot_blocked: true,
        },
        checkout: {
          pending_payment: true,
          frozen_snapshot: true,
          no_payment: true,
        },
        live: {
          fixture: true,
          valid_destination: true,
          unsupported_destination: true,
          ended_guard: true,
          self_purchase_guard: true,
          idempotent: true,
          creator_attribution: true,
          no_payment: true,
        },
        rollback: { global_counts_unchanged: true, inventory_restored: true },
        reconciliation: { payments: 0, settlements: 0, commissions: 0 },
      },
      null,
      2,
    ),
  );
} catch (e) {
  if (open) await db.query("rollback").catch(() => {});
  console.error(`MARKETPLACE_SHIPPING_PROOF_FAILED:${stage}:${safe(e)}`);
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
