import { describe, expect, it, vi } from "vitest";
import type { BusinessSupabaseClient } from "../lib/supabase";
import { getBusinessAnalytics } from "../lib/businessAnalyticsApi";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const payload = {
  business_owner_id: "owner-a",
  range: "30d",
  timezone: "UTC",
  generated_at: "2026-09-18T12:00:00Z",
  window: {
    current_start: "2026-08-20T00:00:00Z",
    current_end: "2026-09-19T00:00:00Z",
    previous_start: "2026-07-21T00:00:00Z",
    previous_end: "2026-08-20T00:00:00Z",
  },
  commerce: {
    current: { gmv_bdag: "123456789012345.12345678", orders: 3, units: 4, product_views: 11, cart_adds: 2, refunded_bdag: "10.00000000" },
    previous: { gmv_bdag: "100", orders: 2, units: 2, product_views: 9, cart_adds: 1, refunded_bdag: "0" },
    comparisons: { gmv_percent: "23.45", orders_percent: "50", units_percent: "100", product_views_percent: "22.22" },
    daily: [
      { day: "2026-08-20", gmv_bdag: "0", orders: 0, units: 0, product_views: 0 },
      { day: "2026-08-21", gmv_bdag: "25.50", orders: 1, units: 1, product_views: 2 },
    ],
    products: {
      items: [{ product_id: "product-1", title: "Producto", image_url: null, views: 8, units: 3, orders: 2, gmv_bdag: "75.25" }],
      total_count: 25,
    },
    variants: {
      items: [{ variant_id: "variant-1", product_id: "product-1", label: "SKU-1", views: 4, units: 2, orders: 1, gmv_bdag: "50" }],
      total_count: 1,
    },
    sources: [{ source: "shop", views: 5, cart_adds: 1, orders: 2, units: 3, gmv_bdag: "75.25" }],
  },
  ads: { authorized: false, data: null },
  finance: { authorized: true, data: { bdag_balance: "999.00000000", settled_orders: 2, seller_net_bdag: "60.12345678" } },
  payouts: { authorized: false, data: null },
};

describe("Business Analytics API", () => {
  it.each(["7d", "30d", "90d"] as const)("requests the %s server range", async (range) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...payload, range }, error: null });
    const result = await getBusinessAnalytics("owner-a", range, { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("get_my_business_analytics", { p_business_owner_id: "owner-a", p_range: range });
    expect(result.range).toBe(range);
  });

  it("preserves exact monetary strings and global counts", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    const result = await getBusinessAnalytics("owner-a", "30d", { rpc } as unknown as BusinessSupabaseClient);
    expect(result.commerce.current.gmvBdag).toBe("123456789012345.12345678");
    expect(result.finance).toEqual({ authorized: true, data: { bdagBalance: "999.00000000", settledOrders: 2, sellerNetBdag: "60.12345678" } });
    expect(result.commerce.products).toMatchObject({ totalCount: 25 });
  });

  it("keeps unauthorized sections distinct from authorized zero data", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    const result = await getBusinessAnalytics("owner-a", "30d", { rpc } as unknown as BusinessSupabaseClient);
    expect(result.ads).toEqual({ authorized: false, data: null });
    expect(result.payouts).toEqual({ authorized: false, data: null });
    expect(result.finance.authorized).toBe(true);
  });

  it("rejects malformed optional envelopes instead of inventing zero values", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...payload, ads: { authorized: false, data: { impressions: 0 } } }, error: null });
    await expect(getBusinessAnalytics("owner-a", "30d", { rpc } as unknown as BusinessSupabaseClient)).rejects.toThrow("business_analytics_section_invalid");
  });
});
