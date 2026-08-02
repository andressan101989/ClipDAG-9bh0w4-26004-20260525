import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260803024500_fix_mkt_a4b_offer_precedence.sql",
  "utf8",
);
const pinCorrection = fs.readFileSync(
  "supabase/migrations/20260803024600_fix_mkt_a4b_pin_resolver_record.sql",
  "utf8",
);

const resolveOffer = (offers, creatorId, now = 100) =>
  offers
    .filter(
      (offer) =>
        offer.status === "active" &&
        (offer.startsAt == null || offer.startsAt <= now) &&
        (offer.endsAt == null || offer.endsAt > now) &&
        (offer.scope === "public_creator" ||
          (offer.scope === "specific_creator" &&
            offer.creatorId === creatorId)),
    )
    .sort((left, right) => {
      const leftRank =
        left.scope === "specific_creator" && left.creatorId === creatorId
          ? 0
          : 1;
      const rightRank =
        right.scope === "specific_creator" && right.creatorId === creatorId
          ? 0
          : 1;
      return (
        leftRank - rightRank ||
        right.createdAt - left.createdAt ||
        right.id.localeCompare(left.id)
      );
    })[0] ?? null;

const offer = (overrides = {}) => ({
  id: "public",
  scope: "public_creator",
  creatorId: null,
  commissionBps: 500,
  status: "active",
  startsAt: null,
  endsAt: null,
  createdAt: 1,
  ...overrides,
});

test("public-only and specific-only offers resolve authoritatively", () => {
  assert.equal(resolveOffer([offer()], "host").id, "public");
  assert.equal(
    resolveOffer(
      [offer({ id: "specific", scope: "specific_creator", creatorId: "host" })],
      "host",
    ).id,
    "specific",
  );
});

test("specific beats simultaneous newer or higher public offers", () => {
  const specific = offer({
    id: "specific",
    scope: "specific_creator",
    creatorId: "host",
    commissionBps: 700,
    createdAt: 1,
  });
  const newerHigherPublic = offer({
    id: "public-newer",
    commissionBps: 1500,
    createdAt: 2,
  });
  assert.equal(
    resolveOffer([specific, newerHigherPublic], "host").id,
    "specific",
  );
  assert.equal(
    resolveOffer([specific, newerHigherPublic], "unrelated").id,
    "public-newer",
  );
});

test("specific higher commission also wins without using amount ordering", () => {
  const resolved = resolveOffer(
    [
      offer({ commissionBps: 400 }),
      offer({
        id: "specific",
        scope: "specific_creator",
        creatorId: "host",
        commissionBps: 1800,
      }),
    ],
    "host",
  );
  assert.equal(resolved.id, "specific");
  assert.equal(resolved.commissionBps, 1800);
});

test("paused or expired specific falls back to public", () => {
  for (const unavailable of [
    { status: "paused" },
    { endsAt: 100 },
    { status: "removed" },
  ]) {
    const resolved = resolveOffer(
      [
        offer(),
        offer({
          id: "specific",
          scope: "specific_creator",
          creatorId: "host",
          ...unavailable,
        }),
      ],
      "host",
    );
    assert.equal(resolved.id, "public");
  }
});

test("paused public does not affect valid specific and both unavailable reject", () => {
  const specific = offer({
    id: "specific",
    scope: "specific_creator",
    creatorId: "host",
  });
  assert.equal(
    resolveOffer([offer({ status: "paused" }), specific], "host").id,
    "specific",
  );
  assert.equal(
    resolveOffer(
      [offer({ status: "paused" }), { ...specific, status: "removed" }],
      "host",
    ),
    null,
  );
});

test("candidate and pin paths call the same resolver", () => {
  const calls = migration.match(
    /marketplace_resolve_live_affiliate_offer\s*\(/g,
  );
  assert.ok(calls.length >= 3);
  assert.match(
    migration,
    /cross join lateral public\.marketplace_resolve_live_affiliate_offer/,
  );
  assert.match(
    migration,
    /select\*into offer from public\.marketplace_resolve_live_affiliate_offer\(p\.id,actor\)/,
  );
  assert.doesNotMatch(migration, /\(creator_id=actor\)desc/);
});

test("resolver explicitly encodes specific-first deterministic precedence", () => {
  assert.match(
    migration,
    /case[\s\S]*offer\.offer_scope = 'specific_creator'[\s\S]*offer\.creator_id = p_creator_id[\s\S]*then 0[\s\S]*else 1[\s\S]*end,[\s\S]*offer\.created_at desc,[\s\S]*offer\.id desc/,
  );
  assert.match(migration, /limit 1/);
  assert.match(
    migration,
    /stable[\s\S]*security definer[\s\S]*set search_path = public/,
  );
});

test("pin snapshots resolved offer identity and rate without changing old pins", () => {
  assert.match(migration, /bps:=offer\.commission_bps/);
  assert.match(migration, /mode,bps,offer\.offer_id/);
  assert.match(
    migration,
    /select\*into r from public\.live_session_products[\s\S]*status='active'/,
  );
  assert.doesNotMatch(
    migration,
    /update public\.live_session_products set creator_commission_bps/,
  );
});

test("candidate lifecycle and pagination behavior remain complete", () => {
  for (const field of [
    "pinned_creator_commission_bps",
    "current_offer_commission_bps",
    "current_offer_id",
    "pinned_offer_id",
    "requires_repin",
    "affiliate_offer_unavailable",
    "affiliate_offer_replaced",
  ])
    assert.match(migration, new RegExp(field));
  assert.match(migration, /limit page_limit \+ 1/);
  assert.match(
    migration,
    /\(product\.updated_at, product\.id\) < \(p_before_updated_at, p_before_id\)/,
  );
});

test("resolver is private while candidate and pin grants remain role-scoped", () => {
  assert.match(
    migration,
    /revoke all on function public\.marketplace_resolve_live_affiliate_offer\(uuid,uuid\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(migration, /to service_role/);
});

test("own-product pinning never dereferences an unassigned resolver record", () => {
  assert.match(pinCorrection, /resolved_offer_id uuid/);
  assert.match(pinCorrection, /resolved_offer_bps integer/);
  assert.match(
    pinCorrection,
    /select offer_id,commission_bps into resolved_offer_id,resolved_offer_bps/,
  );
  assert.doesNotMatch(pinCorrection, /offer record/);
  assert.match(pinCorrection, /mode,bps,resolved_offer_id/);
});
