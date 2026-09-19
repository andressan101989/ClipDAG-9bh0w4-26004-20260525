import assert from "node:assert/strict";
import test from "node:test";
import { stripeCheckoutReturnUrls } from "../supabase/functions/_shared/stripeBilling.ts";

test("Stripe return URLs target private Business finance without a doubled prefix", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  for (const configured of ["https://nelyon.app", "https://nelyon.app/", "https://nelyon.app/business/"]) {
    const urls = stripeCheckoutReturnUrls(configured, id);
    assert.equal(urls.success, `https://nelyon.app/business/finance?stripe=success&topup=${id}`);
    assert.equal(urls.cancel, `https://nelyon.app/business/finance?stripe=cancelled&topup=${id}`);
    assert.doesNotMatch(`${urls.success}${urls.cancel}`, /\/business\/business\/|cs_|pi_|cus_/);
  }
});
