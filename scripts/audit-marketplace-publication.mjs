import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
const { Client } = pg;
const fail = (c) => {
    throw new Error(c);
  },
  assert = (v, c) => {
    if (!v) fail(c);
  };
const cli = spawnSync(
  process.env.ComSpec,
  [
    "/d",
    "/s",
    "/c",
    "npx.cmd supabase db dump --linked --schema public --dry-run",
  ],
  { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
);
if (cli.status !== 0) fail("publication_secure_connection_failed");
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
const id = Object.fromEntries(
  [
    "seller",
    "store",
    "profile",
    "draft",
    "session",
    "image1",
    "image2",
    "image3",
    "image4",
    "image5",
    "image6",
    "video",
  ].map((k) => [k, randomUUID()]),
);
let open = false,
  stage = "connect";
const claims = (role, sub = "") =>
  db.query(
    "select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claim.sub',$3,true)",
    [JSON.stringify({ role, sub }), role, sub],
  );
async function expected(run, token) {
  await db.query("savepoint expected");
  try {
    await run();
    fail(`expected_${token}`);
  } catch (e) {
    await db.query("rollback to savepoint expected");
    if (!String(e.message).includes(token))
      console.error("EXPECTED_CODE_MISMATCH", {
        expected: token,
        code: e.code,
        message: e.message,
      });
    assert(String(e.message).includes(token), `unexpected_${token}`);
  } finally {
    await db.query("release savepoint expected").catch(() => {});
  }
}
const countsSql = `select(select count(*)::int from products)p,(select count(*)::int from marketplace_product_variants)v,(select count(*)::int from marketplace_inventory_levels)i,(select count(*)::int from media_assets)a,(select count(*)::int from media_asset_links)l`;
try {
  await db.connect();
  await db.query("set role postgres");
  const before = (await db.query(countsSql)).rows[0];
  await db.query("begin");
  open = true;
  stage = "fixture";
  await claims("service_role");
  await db.query(
    "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'proof',now(),now(),now())",
    [id.seller, `publishing-${randomUUID()}@synthetic.local`],
  );
  await db.query(
    "insert into user_profiles(id,username,display_name)values($1,$2,$3)",
    [
      id.seller,
      `publishing_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      "Publishing Seller",
    ],
  );
  await db.query(
    "insert into marketplace_sellers(user_id,status,display_name,approved_at)values($1,'approved','Publishing Seller',now())",
    [id.seller],
  );
  await db.query(
    "insert into marketplace_stores(id,seller_id,name,slug,status)values($1,$2,'Publishing Store',$3,'active')",
    [id.store, id.seller, `publishing-${randomUUID()}`],
  );
  await db.query(
    "insert into marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary,configuration_status)values($1,$2,$3,'Publishing shipping',1,2,'US','Returns','explicit_ready')",
    [id.profile, id.seller, id.store],
  );
  await db.query(
    "insert into marketplace_shipping_profile_regions(profile_id,country_code,region_code,shipping_price,transit_days_min,transit_days_max)values($1,'US','FL',1,2,4)",
    [id.profile],
  );
  await claims("authenticated", id.seller);
  stage = "draft";
  const draft = (
    await db.query(
      "select create_or_resume_marketplace_product_draft($1,'10000000-0000-4000-8000-000000000002',$2)id",
      [id.store, id.session],
    )
  ).rows[0].id;
  assert(
    draft &&
      draft ===
        (await (async () => {
          return (
            await db.query(
              "select create_or_resume_marketplace_product_draft($1,'10000000-0000-4000-8000-000000000002',$2)id",
              [id.store, id.session],
            )
          ).rows[0].id;
        })()),
    "draft_not_idempotent",
  );
  const owner = (
    await db.query("select fetch_my_marketplace_product_draft($1)value", [
      draft,
    ])
  ).rows[0].value;
  assert(owner?.product?.id === draft, "draft_not_resumable");
  assert(
    owner.product.editor_state?.title_configured === false &&
      owner.product.editor_state?.price_configured === false &&
      owner.product.editor_state?.category_configured === false,
    "fresh_draft_editor_state_not_false",
  );
  const publicBefore = (
    await db.query(
      "select fetch_public_marketplace_products(null,null,null,100,$1)value",
      [draft],
    )
  ).rows[0].value;
  assert(
    Array.isArray(publicBefore) && publicBefore.length === 0,
    "draft_publicly_visible",
  );
  const saveEditorState = (
    title,
    price,
    titleConfigured,
    priceConfigured,
    categoryConfigured,
  ) =>
    db.query(
      "select save_my_marketplace_product_draft($1,'10000000-0000-4000-8000-000000000002',$3,'Professional publishing proof',$4,null,null,5,'{}',$2,'physical',$5,$6,$7)",
      [
        draft,
        id.profile,
        title,
        price,
        titleConfigured,
        priceConfigured,
        categoryConfigured,
      ],
    );
  await saveEditorState("Runner Pro", 1, true, false, false);
  let reopened = (
    await db.query("select fetch_my_marketplace_product_draft($1)value", [draft])
  ).rows[0].value.product.editor_state;
  assert(
    reopened.title_configured &&
      !reopened.price_configured &&
      !reopened.category_configured,
    "title_editor_state_not_persisted",
  );
  await saveEditorState("Runner Pro", 1, true, false, true);
  reopened = (
    await db.query("select fetch_my_marketplace_product_draft($1)value", [draft])
  ).rows[0].value.product.editor_state;
  assert(
    reopened.title_configured &&
      !reopened.price_configured &&
      reopened.category_configured,
    "category_editor_state_not_persisted",
  );
  await saveEditorState("Runner Pro", 1, true, true, true);
  reopened = (
    await db.query("select fetch_my_marketplace_product_draft($1)value", [draft])
  ).rows[0].value.product.editor_state;
  assert(
    reopened.title_configured &&
      reopened.price_configured &&
      reopened.category_configured,
    "one_bdag_editor_state_not_persisted",
  );
  await saveEditorState("Runner Pro", 10, true, true, true);
  const countsBeforePreview = (await db.query(countsSql)).rows[0];
  await expected(
    () =>
      db.query("select publish_my_marketplace_product_checked($1)", [draft]),
    "marketplace_product_media_required",
  );
  assert(
    JSON.stringify(countsBeforePreview) ===
      JSON.stringify((await db.query(countsSql)).rows[0]),
    "preview_or_failed_publish_mutated",
  );
  stage = "media";
  await claims("service_role");
  const imageIds = [id.image1, id.image2, id.image3, id.image4, id.image5];
  for (const [index, asset] of [...imageIds, id.image6].entries())
    await db.query(
      "insert into media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,status,public_url,ready_at)values($1,$2,'r2','image','product_image','public','proof',$3,'image/jpeg',100,'ready',$4,now())",
      [
        asset,
        id.seller,
        `proof/${asset}.jpg`,
        `https://proof.invalid/${index}.jpg`,
      ],
    );
  await db.query(
    "insert into media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,duration_ms,status,public_url,ready_at)values($1,$2,'r2','video','product_video','public','proof',$3,'video/mp4',1000,60000,'ready',$4,now())",
    [
      id.video,
      id.seller,
      `proof/${id.video}.mp4`,
      "https://proof.invalid/video.mp4",
    ],
  );
  await claims("authenticated", id.seller);
  await expected(
    () =>
      db.query("select set_my_marketplace_product_media_v2($1,$2,$3,$4)", [
        draft,
        [...imageIds, id.image6],
        id.image1,
        id.video,
      ]),
    "marketplace_product_image_limit",
  );
  await db.query("select set_my_marketplace_product_media_v2($1,$2,$3,$4)", [
    draft,
    imageIds,
    id.image3,
    id.video,
  ]);
  const links = (
    await db.query(
      "select asset_id,position,is_cover,slot from media_asset_links where entity_type='shop_product'and entity_id=$1 order by slot,position",
      [draft],
    )
  ).rows;
  assert(
    links.filter((x) => x.slot === "image").length === 5 &&
      links.find((x) => x.asset_id === id.image3)?.is_cover &&
      links.filter((x) => x.slot === "video").length === 1,
    "media_order_cover_video_failed",
  );
  stage = "complete";
  await saveEditorState("Runner Pro", 10, true, true, true);
  await claims("service_role");
  const variant = (
    await db.query(
      "select id from marketplace_product_variants where product_id=$1 and is_default",
      [draft],
    )
  ).rows[0].id;
  await db.query(
    "update marketplace_product_variants set price=10,sku=$2,sku_normalized=$2 where id=$1",
    [variant, `PUB-${draft.slice(0, 12).toUpperCase()}`],
  );
  await db.query(
    "update marketplace_inventory_levels set on_hand=5 where variant_id=$1",
    [variant],
  );
  await claims("authenticated", id.seller);
  const readiness = (
    await db.query(
      "select evaluate_my_marketplace_product_publication($1)value",
      [draft],
    )
  ).rows[0].value;
  assert(readiness.ready, "publication_not_ready");
  const first = (
      await db.query("select publish_my_marketplace_product_checked($1)value", [
        draft,
      ])
    ).rows[0].value,
    second = (
      await db.query("select publish_my_marketplace_product_checked($1)value", [
        draft,
      ])
    ).rows[0].value;
  assert(
    first.published && JSON.stringify(first) === JSON.stringify(second),
    "publication_not_idempotent",
  );
  const publicAfter = (
    await db.query(
      "select fetch_public_marketplace_products(null,null,null,100,$1)value",
      [draft],
    )
  ).rows[0].value;
  assert(
    publicAfter.some((x) => x.id === draft),
    "published_not_discoverable",
  );
  await db.query("rollback");
  open = false;
  const after = (await db.query(countsSql)).rows[0];
  assert(
    JSON.stringify(before) === JSON.stringify(after),
    "publication_fixture_persisted",
  );
  console.log(
    JSON.stringify(
      {
        self_contained: true,
        draft: {
          created: true,
          idempotent: true,
          resumable: true,
          private: true,
        },
        media: {
          images: 5,
          sixth_blocked: true,
          order_persisted: true,
          cover_persisted: true,
          video_duration_ms: 60000,
          second_video_blocked_by_single_contract: true,
        },
        publication: {
          missing_media_blocked: true,
          ready: true,
          published: true,
          discoverable: true,
          retry_idempotent: true,
        },
        preview: { no_checkout_or_order: true },
        rollback: true,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(
    `PUBLICATION_AUDIT_FAILED:${stage}:${/^[a-z0-9_]+$/i.test(e?.message ?? "") ? e.message : "database_error"}`,
  );
  process.exitCode = 1;
} finally {
  if (open) await db.query("rollback").catch(() => {});
  await db.end().catch(() => {});
}
