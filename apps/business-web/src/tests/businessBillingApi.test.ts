import { describe, expect, it, vi } from "vitest";
import {
  createStripeBdagCheckout,
  getBusinessBillingOverview,
  usdInputToCents,
} from "../lib/businessBillingApi";
import type { BusinessSupabaseClient } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

function client() {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: {
        business_owner_id: "owner-1",
        bdag_balance: "125.5",
        stripe: { topups: [{
          id: "topup-1", status: "credited", amount_usd_cents: 1000,
          bdag_amount: "1000", created_at: "2026-09-17T00:00:00Z",
          credited_at: "2026-09-17T00:01:00Z",
        }] },
      },
      error: null,
    }),
    functions: { invoke: vi.fn().mockResolvedValue({
      data: { available: true, mode: "test", currency: "usd", minimum_usd_cents: 50, maximum_usd_cents: 99999999, bdag_per_usd: 100 },
      error: null,
    }) },
  } as unknown as BusinessSupabaseClient;
}

describe("Business Stripe billing client", () => {
  it("parses the capability-scoped overview without provider identifiers", async () => {
    const gateway = client();
    const result = await getBusinessBillingOverview("owner-1", gateway);
    expect(result.bdagBalance).toBe(125.5);
    expect(result.stripe.available).toBe(true);
    expect(result.stripe.topups[0]).toEqual(expect.objectContaining({ amountUsdCents: 1000, bdagAmount: 1000 }));
    expect(gateway.rpc).toHaveBeenCalledWith("get_my_business_billing_overview", { p_business_owner_id: "owner-1", p_limit: 20 });
    expect(JSON.stringify(result)).not.toMatch(/payment_intent|customer_id|financial_transaction|webhook_event/i);
  });

  it("converts decimal USD input to integer cents without binary rounding", () => {
    expect(usdInputToCents("0.50")).toBe(50);
    expect(usdInputToCents("1.00")).toBe(100);
    expect(usdInputToCents("10.25")).toBe(1025);
    expect(usdInputToCents("1.001")).toBeNull();
    expect(usdInputToCents("-1")).toBeNull();
  });

  it("starts hosted Checkout with only integer cents and an idempotency UUID", async () => {
    const gateway = client();
    gateway.functions.invoke = vi.fn().mockResolvedValue({
      data: { checkout_url: "https://checkout.stripe.com/test", topup_id: "topup-1", bdag_amount: 1000 }, error: null,
    });
    await expect(createStripeBdagCheckout(1000, "11111111-1111-4111-8111-111111111111", gateway)).resolves.toEqual({
      checkoutUrl: "https://checkout.stripe.com/test", topupId: "topup-1", bdagAmount: 1000,
    });
    expect(gateway.functions.invoke).toHaveBeenCalledWith("stripe-bdag-checkout", {
      method: "POST", body: { amount_usd_cents: 1000, idempotency_key: "11111111-1111-4111-8111-111111111111" },
    });
  });
});
