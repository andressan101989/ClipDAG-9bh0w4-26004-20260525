import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessSupabaseClient } from "../lib/supabase";
import {
  activateAdCampaign,
  createAdCampaignDraft,
  fetchAdConfig,
  pauseAdCampaign,
  resumeAdCampaign,
  searchAdCampaigns,
  searchEligibleAdProducts,
  setAdCampaignPlacements,
} from "../lib/adsManagerApi";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

const campaign = {
  id: "campaign-1", product_id: "product-1", product_title: "Camisa", product_image_url: null,
  name: "Campaña", status: "completed", starts_at: "2026-09-01T00:00:00Z", ends_at: "2026-09-02T00:00:00Z",
  total_budget_bdag: "100", spent_bdag: "99.97569444", released_bdag: "0.02430556", remaining_reserved_bdag: "0",
  eligible_elapsed_seconds: 3600, eligibility_state: false, eligibility_reason: "terminal",
  impressions: 10, clicks: 2, product_views: 4, cart_adds: 1, orders: 1, attributed_gmv_bdag: "25",
  finalized_at: "2026-09-02T00:00:00Z", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-02T00:00:00Z",
  placements: ["marketplace_home", "marketplace_search"],
};

describe("Ads Manager canonical API", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses bounded business-scoped campaign pagination and preserves numeric precision", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      items: [campaign], next_cursor: { created_at: campaign.created_at, id: campaign.id },
      summary: { active_campaigns: 0, total_budget_bdag: "100", spent_bdag: "99.97569444", impressions: 10, clicks: 2, orders: 1, attributed_gmv_bdag: "25" },
    }, error: null });
    const page = await searchAdCampaigns("owner-a", { status: "completed", cursor: { createdAt: "2026-09-03T00:00:00Z", id: "cursor" }, limit: 20 }, { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("search_my_business_ad_campaigns", {
      p_business_owner_id: "owner-a", p_status: "completed", p_cursor_created_at: "2026-09-03T00:00:00Z", p_cursor_id: "cursor", p_limit: 20,
    });
    expect(page.items[0]).toMatchObject({ totalBudgetBdag: 100, spentBdag: 99.97569444, releasedBdag: 0.02430556 });
    expect(page.items[0].placements).toEqual(["marketplace_home", "marketplace_search"]);
    expect(page.nextCursor).toEqual({ createdAt: campaign.created_at, id: campaign.id });
  });

  it("sets placements through the single non-financial canonical mutation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { campaign_id: "campaign-1", placements: ["social_feed"] }, error: null });
    await setAdCampaignPlacements("campaign-1", ["social_feed"], { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("set_my_marketplace_ad_campaign_placements", {
      p_campaign_id: "campaign-1",
      p_surfaces: ["social_feed"],
    });
  });

  it("uses canonical eligibility and configuration projections without hardcoded limits", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { items: [{ id: "product-1", title: "Camisa", thumbnail_url: null, price: "25", currency: "BDAG", created_at: "2026-09-01T00:00:00Z" }], next_cursor: null }, error: null })
      .mockResolvedValueOnce({ data: { minimum_budget_bdag: 10, maximum_budget_bdag: 1000000, minimum_duration_seconds: 3600, maximum_duration_seconds: 2592000 }, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    const products = await searchEligibleAdProducts("owner-a", undefined, client);
    const config = await fetchAdConfig(client);
    expect(products.items[0].id).toBe("product-1");
    expect(rpc).toHaveBeenNthCalledWith(1, "search_my_business_ad_eligible_products", expect.objectContaining({ p_business_owner_id: "owner-a", p_limit: 30 }));
    expect(rpc).toHaveBeenNthCalledWith(2, "fetch_marketplace_ad_config");
    expect(config).toEqual({ minimumBudgetBdag: 10, maximumBudgetBdag: 1000000, minimumDurationSeconds: 3600, maximumDurationSeconds: 2592000 });
  });

  it("creates a draft through the canonical mutation with a UUID and no owner supplied by the browser", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    const rpc = vi.fn().mockResolvedValue({ data: { id: "campaign-1" }, error: null });
    await createAdCampaignDraft({ productId: "product-1", name: "Campaña", budgetBdag: 10, startsAt: "2026-09-18T00:00:00Z", endsAt: "2026-09-19T00:00:00Z" }, { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("create_marketplace_ad_campaign_draft", expect.objectContaining({ p_product_id: "product-1", p_idempotency_key: "11111111-1111-4111-8111-111111111111" }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_business_owner_id");
    expect(rpc.mock.calls.flat().join(" ")).not.toContain("ledger");
  });

  it("keeps activation separate and idempotent while pause/resume use canonical RPCs", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("22222222-2222-4222-8222-222222222222");
    const rpc = vi.fn().mockResolvedValue({ data: { id: "campaign-1" }, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    await activateAdCampaign("campaign-1", client);
    await pauseAdCampaign("campaign-1", client);
    await resumeAdCampaign("campaign-1", client);
    expect(rpc).toHaveBeenNthCalledWith(1, "activate_marketplace_ad_campaign", { p_campaign_id: "campaign-1", p_idempotency_key: "22222222-2222-4222-8222-222222222222" });
    expect(rpc).toHaveBeenNthCalledWith(2, "pause_marketplace_ad_campaign", { p_campaign_id: "campaign-1" });
    expect(rpc).toHaveBeenNthCalledWith(3, "resume_marketplace_ad_campaign", { p_campaign_id: "campaign-1" });
    expect(rpc.mock.calls.flat().join(" ")).not.toMatch(/spend_marketplace|release_marketplace|finalize_marketplace/);
  });
});
