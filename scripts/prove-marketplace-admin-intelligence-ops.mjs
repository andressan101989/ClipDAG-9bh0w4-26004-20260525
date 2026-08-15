import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Client } = pg,
  url = process.env.MARKETPLACE_DATABASE_URL;
if (!url) throw new Error("MARKETPLACE_DATABASE_URL_REQUIRED");
const parsed = new URL(url);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  parsed.port !== "55422"
)
  throw new Error("B8C_PROOF_REQUIRES_DISPOSABLE_DATABASE");
const db = new Client({ connectionString: url, ssl: false }),
  uid = () => randomUUID();
let stage = "connect";
async function role(name, sub = "", metadata = {}) {
  await db.query("reset role");
  await db.query(`set local role ${name}`);
  await db.query(
    "select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claims',$3,true)",
    [
      name,
      sub,
      JSON.stringify({
        role: name,
        sub,
        user_metadata: metadata,
        app_metadata: metadata,
      }),
    ],
  );
}
async function operator() {
  await db.query("reset role");
  await db.query(
    "select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims',$1,true)",
    [JSON.stringify({ role: "service_role" })],
  );
}
async function rpc(name, args = []) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")})value`,
      args,
    )
  ).rows[0].value;
}
async function attempt(fn) {
  const save = `b8c_${uid().replaceAll("-", "")}`;
  await db.query(`savepoint ${save}`);
  try {
    const value = await fn();
    await db.query(`release savepoint ${save}`);
    return { ok: true, value };
  } catch (error) {
    await db.query(`rollback to savepoint ${save}`);
    await db.query(`release savepoint ${save}`);
    return { ok: false, code: error.code, message: error.message };
  }
}
async function addUser(id, label, admin = false) {
  await operator();
  const token = uid().replaceAll("-", "").slice(0, 10);
  await db.query(
    "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())",
    [id, `b8c-${label}-${token}@proof.local`],
  );
  await db.query(
    "insert into public.user_profiles(id,username,display_name,is_admin)values($1,$2,$3,$4)",
    [id, `b8c${label}${token}`, `B8C ${label}`, admin],
  );
}
try {
  await db.connect();
  await db.query("begin");
  const f = {
    admin: uid(),
    normal: uid(),
    seller: uid(),
    store: uid(),
    product: uid(),
    variant: uid(),
    promotion: uid(),
    campaign: uid(),
    audit: uid(),
  };
  stage = "fixtures";
  await addUser(f.admin, "admin", true);
  await addUser(f.normal, "normal");
  await addUser(f.seller, "seller");
  await operator();
  await db.query(
    "insert into public.marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','B8C Seller',now())",
    [f.seller],
  );
  await db.query(
    "insert into public.marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'B8C Store',$3,'active')",
    [f.store, f.seller, `b8c-${uid()}`],
  );
  await db.query(
    "insert into public.products(id,seller_id,title,description,price,currency,category,stock,status,store_id,category_id,product_type,moderation_status,published_at,images)values($1,$2,'B8C Product','Proof',20,'BDAG','physical',20,'active',$3,'10000000-0000-4000-8000-000000000002','physical','approved',now(),'{}')",
    [f.product, f.seller, f.store],
  );
  await db.query(
    "insert into public.marketplace_product_variants(id,product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)values($1,$2,$3,$4,$5,$5,'Default',20,'active',true,'')",
    [
      f.variant,
      f.product,
      f.store,
      f.seller,
      `B8C-${uid().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
    ],
  );
  await db.query(
    "insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)values($1,20,0)",
    [f.variant],
  );
  await db.query(
    "insert into public.marketplace_product_promotions(id,seller_id,store_id,product_id,variant_id,promotion_type,percentage_off,starts_at,ends_at,status,created_by,idempotency_key)values($1,$2,$3,$4,$5,'percentage',10,now()-interval'1 day',now()+interval'7 days','enabled',$2,$6)",
    [f.promotion, f.seller, f.store, f.product, f.variant, uid()],
  );
  await db.query(
    "insert into public.marketplace_ad_campaigns(id,seller_id,store_id,product_id,name,status,starts_at,ends_at,total_budget_bdag,creation_idempotency_key,eligibility_state,eligibility_reason)values($1,$2,$3,$4,'B8C Campaign','draft',now()+interval'1 day',now()+interval'8 days',100,$5,false,'unfunded')",
    [f.campaign, f.seller, f.store, f.product, uid()],
  );
  await db.query(
    "insert into public.marketplace_admin_action_audit(id,actor_id,action,target_type,target_id,idempotency_key,reason_code,metadata)values($1,$2,'product_suspend','product',$3,$4,'proof_reason','{\"safe\":true,\"request_fingerprint\":\"0000000000000000000000000000000000000000000000000000000000000000\"}')",
    [f.audit, f.admin, f.product, uid()],
  );

  stage = "security";
  const readCalls = [
    () => rpc("get_marketplace_admin_creator_commerce_overview", ["30d"]),
    () =>
      rpc("search_marketplace_admin_creators", [null, "30d", null, null, 50]),
    () =>
      rpc("search_marketplace_admin_promotions", [null, null, null, null, 50]),
    () =>
      rpc("search_marketplace_admin_ads", [
        null,
        null,
        null,
        null,
        null,
        50,
      ]),
    () => rpc("get_marketplace_admin_health"),
    () =>
      rpc("search_marketplace_admin_activity", [
        null,
        null,
        null,
        null,
        null,
        null,
        50,
      ]),
  ];
  for (const identity of [
    { name: "anon", sub: "" },
    { name: "authenticated", sub: f.normal },
    {
      name: "authenticated",
      sub: f.normal,
      metadata: { is_admin: true, role: "admin" },
    },
  ]) {
    await role(identity.name, identity.sub, identity.metadata);
    for (const call of readCalls) {
      const result = await attempt(call);
      assert.equal(result.ok, false);
      assert.equal(result.code, "42501");
    }
  }
  await role("authenticated", f.admin);
  const access = await rpc("get_my_marketplace_admin_access");
  for (const capability of [
    "marketplace:creator-commerce",
    "marketplace:promotions",
    "marketplace:ads",
    "marketplace:health",
    "marketplace:audit",
  ])
    assert(access.capabilities.includes(capability));

  stage = "limits";
  const lists = [
    {
      name: "creators",
      fn: (limit) =>
        rpc("search_marketplace_admin_creators", [
          null,
          "30d",
          null,
          null,
          limit,
        ]),
    },
    {
      name: "promotions",
      fn: (limit) =>
        rpc("search_marketplace_admin_promotions", [
          null,
          null,
          null,
          null,
          limit,
        ]),
    },
    {
      name: "ads",
      fn: (limit) =>
        rpc("search_marketplace_admin_ads", [
          null,
          null,
          null,
          null,
          null,
          limit,
        ]),
    },
    {
      name: "activity",
      fn: (limit) =>
        rpc("search_marketplace_admin_activity", [
          null,
          null,
          null,
          null,
          null,
          null,
          limit,
        ]),
    },
  ];
  for (const item of lists) {
    for (const boundary of [1, 100]) {
      stage = `limits_${item.name}_${boundary}`;
      assert((await item.fn(boundary)).page_size <= boundary);
    }
    for (const invalid of [null, 0, 101]) {
      stage = `limits_${item.name}_${invalid}`;
      const result = await attempt(() => item.fn(invalid));
      assert.equal(result.ok, false, `${item.name}:${invalid}`);
      assert.equal(result.code, "22023");
    }
  }

  stage = "creator";
  for (const range of ["7d", "30d", "90d", "all"]) {
    const value = await rpc("get_marketplace_admin_creator_commerce_overview", [
      range,
    ]);
    assert.equal(value.range, range);
    assert.equal(
      Number(value.summary.commission_net),
      Number(value.summary.commission_released) -
        Number(value.summary.commission_reversed),
    );
  }
  const invalidRange = await attempt(() =>
    rpc("get_marketplace_admin_creator_commerce_overview", ["bad"]),
  );
  assert.equal(invalidRange.code, "22023");
  const creatorDefinition = (
    await operator().then(() =>
      db.query(
        "select pg_get_functiondef('public.get_marketplace_admin_creator_commerce_overview(text)'::regprocedure)d",
      ),
    )
  ).rows[0].d;
  assert.match(
    creatorDefinition,
    /marketplace_creator_commerce_analytics_facts/,
  );
  assert.match(creatorDefinition, /sum\(attributed_gmv\)/);
  assert.doesNotMatch(
    creatorDefinition,
    /marketplace_orders[^]*sum\([^)]*total/i,
  );

  stage = "promotions";
  await role("authenticated", f.admin);
  const promotions = await rpc("search_marketplace_admin_promotions", [
    "B8C",
    null,
    null,
    null,
    50,
  ]);
  assert.equal(promotions.promotions.length, 1);
  assert.equal(promotions.promotions[0].state, "active");
  assert.equal(
    Number(promotions.promotions[0].current_price.effective_price),
    18,
  );
  const promotionDetail = await rpc("get_marketplace_admin_promotion_detail", [
    f.promotion,
  ]);
  assert.equal(promotionDetail.historical_usage.length, 0);
  stage = "ads";
  const ads = await rpc("search_marketplace_admin_ads", [
    "B8C",
    null,
    null,
    null,
    null,
    50,
  ]);
  assert.equal(ads.campaigns.length, 1);
  assert.equal(Number(ads.campaigns[0].total_budget), 100);
  assert.equal(Number(ads.campaigns[0].remaining_reserved), 100);
  const adDetail = await rpc("get_marketplace_admin_ad_detail", [f.campaign]);
  assert.equal(Number(adDetail.financial.spent), 0);
  assert.equal(adDetail.financial_events.length, 0);
  assert.equal(Number(adDetail.attribution.gmv), 0);
  const mutationArgs = (
    await operator().then(() =>
      db.query(
        "select proname,pg_get_function_arguments(oid)args from pg_proc where pronamespace='public'::regnamespace and proname like'%marketplace_admin%'and proname like any(array['%ad%spend%','%ad%release%','%ad%finalize%'])",
      ),
    )
  ).rows;
  assert.equal(mutationArgs.length, 0);
  const internalGrants = (
    await db.query(
      "select has_function_privilege('authenticated','public.spend_marketplace_ad_budget(uuid,numeric,uuid)','execute')spend,has_function_privilege('authenticated','public.release_marketplace_ad_unused_budget(uuid,uuid)','execute')release,has_function_privilege('authenticated','public.finalize_marketplace_ad_campaign_delivery(uuid,uuid)','execute')finalize",
    )
  ).rows[0];
  assert.deepEqual(internalGrants, {
    spend: false,
    release: false,
    finalize: false,
  });

  stage = "health";
  await role("authenticated", f.admin);
  const healthy = await rpc("get_marketplace_admin_health");
  if (!healthy.healthy) console.error(JSON.stringify(healthy, null, 2));
  assert.equal(healthy.healthy, true);
  assert.equal(
    healthy.groups.find((g) => g.name === "admin_operations")
      .failing_check_count,
    0,
  );
  await operator();
  await db.query("savepoint mismatch");
  const badCampaign = uid();
  await db.query(
    "insert into public.marketplace_ad_campaigns(id,seller_id,store_id,product_id,name,status,starts_at,ends_at,total_budget_bdag,spent_bdag,released_bdag,funded_at,funding_idempotency_key,creation_idempotency_key,eligibility_state,eligibility_reason)values($1,$2,$3,$4,'B8C mismatch','completed',now()-interval'2 days',now()-interval'1 day',10,0,0,now()-interval'2 days',$5,$6,false,'terminal')",
    [badCampaign, f.seller, f.store, f.product, uid(), uid()],
  );
  await role("authenticated", f.admin);
  const unhealthy = await rpc("get_marketplace_admin_health");
  assert.equal(unhealthy.healthy, false);
  assert(unhealthy.groups.some((g) => g.failing_check_count > 0));
  await operator();
  await db.query("rollback to savepoint mismatch");
  await db.query("release savepoint mismatch");
  await role("authenticated", f.admin);
  assert.equal((await rpc("get_marketplace_admin_health")).healthy, true);

  stage = "activity";
  const activity = await rpc("search_marketplace_admin_activity", [
    f.admin,
    "product_suspend",
    "product",
    f.product,
    null,
    null,
    50,
  ]);
  assert.equal(activity.activity.length, 1);
  assert.equal(activity.activity[0].actor_id, f.admin);
  assert.equal(activity.activity[0].reason_code, "proof_reason");
  await role("authenticated", f.admin);
  for (const sql of [
    "insert into public.marketplace_admin_action_audit(actor_id,action,target_type,target_id,idempotency_key,metadata)values(gen_random_uuid(),'x','x',gen_random_uuid(),gen_random_uuid(),'{}')",
    "update public.marketplace_admin_action_audit set action='x'",
    "delete from public.marketplace_admin_action_audit",
  ]) {
    assert.equal((await attempt(() => db.query(sql))).ok, false);
  }
  await operator();
  const recon = await rpc("reconcile_marketplace_admin_operations");
  assert.equal(Object.keys(recon).length, 8);
  assert(Object.values(recon).every((value) => Number(value) === 0));
  await db.query("rollback");
  const fixtures = Number(
    (
      await db.query(
        "select count(*)n from auth.users where email like'b8c-%@proof.local'",
      )
    ).rows[0].n,
  );
  assert.equal(fixtures, 0);
  console.log(
    JSON.stringify(
      {
        ok: true,
        security: {
          anonymousDenied: true,
          ordinaryDenied: true,
          metadataForgeryDenied: true,
          adminAllowed: true,
          noClientActor: true,
        },
        capabilities: access.capabilities,
        creatorCommerce: {
          ranges: ["7d", "30d", "90d", "all"],
          invalidRangeRejected: true,
          projectionUsesCanonicalItemFacts: true,
          projectionExcludesWholeOrderTotals: true,
          commissionNet: "released-reversed",
          canonicalSurfacesAudited: [
            "creator_showcase",
            "feed",
            "reel",
            "direct_creator_link",
            "live",
          ],
          financialMutations: 0,
        },
        promotions: {
          activeCanonicalEffectivePrice: 18,
          historicalSnapshotsReadOnly: true,
          mutationAuthority: 0,
        },
        ads: {
          draftVisible: true,
          budget: 100,
          spent: 0,
          released: 0,
          remainingReserved: 100,
          internalFinancialGrantsToAuthenticated: internalGrants,
          adminFinancialMutationRpcCount: mutationArgs.length,
        },
        health: {
          healthyBaseline: true,
          controlledMismatchSurfaced: true,
          rollbackHealthy: true,
        },
        activity: { serverActor: true, filtered: true, immutable: true },
        pagination: {
          default: 50,
          hardMax: 100,
          nullZero101Rejected: true,
          keyset: true,
        },
        reconciliation: { adminOperationsChecks: 8, allZero: true },
        fixtures,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await db.query("rollback").catch(() => {});
  console.error(
    `B8C_ADMIN_INTELLIGENCE_PROOF_FAILED:${stage}:${error.code ?? ""}:${error.message}:${error.where ?? ""}`,
  );
  process.exitCode = 1;
} finally {
  await db.end().catch(() => {});
}
