import { describe, expect, it, vi } from "vitest";
import type { BusinessSupabaseClient } from "../lib/supabase";
import { formatMoney } from "../lib/businessFormat";
import { createProductDraft, respondReturn, searchOrders, searchProducts, setProductMedia, shipOrder } from "../lib/sellerCenterApi";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

describe("Seller Center canonical API", () => {
  it("scopes bounded product reads to the selected business", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [{ id: "p1", title: "Camisa", status: "draft", price: "12.5", currency: "BDAG", variant_count: 1, readiness_reason: null, updated_at: "2026-09-16T00:00:00Z", thumbnail_url: null, available_stock: 4 }], categories: [], next_cursor: null }, error: null });
    const page = await searchProducts("owner-a", { status: "draft", limit: 20 }, { rpc } as unknown as BusinessSupabaseClient);
    expect(page.items[0].price).toBe(12.5);
    expect(rpc).toHaveBeenCalledWith("search_my_business_products", expect.objectContaining({ p_business_owner_id: "owner-a", p_status: "draft", p_limit: 20 }));
  });

  it("creates drafts through the canonical Store-derived mutation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "product-id", error: null });
    await createProductDraft("store-id", "category-id", { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("create_or_resume_marketplace_product_draft", expect.objectContaining({ p_store_id: "store-id", p_category_id: "category-id" }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_seller_id");
  });

  it("assigns product media through the existing canonical mutation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await setProductMedia("product-id", ["asset-id"], "asset-id", { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("set_my_marketplace_product_media_v2", { p_product_id: "product-id", p_image_asset_ids: ["asset-id"], p_cover_asset_id: "asset-id", p_video_asset_id: null });
  });

  it("keeps fulfillment idempotent and entity-derived", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await shipOrder("order-id", { carrier: "UPS", service: "Ground", tracking: "TRACK", url: "https://track.test/TRACK", note: "" }, { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("seller_ship_marketplace_order", expect.objectContaining({ p_order_id: "order-id", p_idempotency_key: expect.any(String) }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_business_owner_id");
  });

  it("uses owner-only canonical return approval rather than client-side refund logic", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await respondReturn("return-id", "approve", "Aprobada", { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("respond_to_marketplace_return", expect.objectContaining({ p_return_id: "return-id", p_decision: "approve" }));
    expect(rpc.mock.calls.flat().join(" ")).not.toContain("ledger");
  });

  it("redacts scope into the orders projection and formats money with two decimals", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { items: [], next_cursor: null }, error: null });
    await searchOrders("owner-b", {}, { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("search_my_business_orders", expect.objectContaining({ p_business_owner_id: "owner-b" }));
    expect(formatMoney(1215.04, "BDAG")).toMatch(/1[.,]215[.,]04 BDAG|1215,04 BDAG/);
  });
});
