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
  createAdvertiserBusinessAccount,
  createAdvertisingCampaignDraft,
  getAdvertiserAccounts,
  getAdvertisingCampaign,
  getAdvertisingCampaignActivationReadiness,
  getAdvertisingCampaigns,
  getAdvertisingFinance,
  getMyAgeEligibility,
  getAdvertisingPlacementSelection,
  isAdvertisingFinanceNotFound,
  remediateMyAgeEligibility,
  activateAdvertisingCampaign,
  pauseAdvertisingCampaign,
  resumeAdvertisingCampaign,
  cancelAdvertisingCampaign,
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

  it("reads and remediates only the current actor through canonical age RPCs", async () => {
    const payload = { status: "eligible", age_band: "age_18_plus", evaluated: true, advertiser_18_plus_eligible: true, policy_version: "nelyon-age-v2", minimum_age: 13 };
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;
    expect(await getMyAgeEligibility(client)).toMatchObject({ ageBand: "age_18_plus", advertiser18PlusEligible: true });
    expect(await remediateMyAgeEligibility("1990-05-10", client)).toMatchObject({ evaluated: true, minimumAge: 13 });
    expect(rpc).toHaveBeenNthCalledWith(1, "get_my_age_eligibility");
    expect(rpc).toHaveBeenNthCalledWith(2, "remediate_my_age_eligibility", { p_date_of_birth: "1990-05-10" });
    expect(rpc.mock.calls.flat().join(" ")).not.toContain("p_user_id");
  });

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

  it("uses the canonical advertiser identity and Campaign V2 read authorities", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { businesses: [] }, error: null })
      .mockResolvedValueOnce({ data: { business_account_id: "business-1", display_name: "Studio", status: "active", access_type: "owner", marketplace: { linked: false, marketplace_seller_user_id: null, seller_status: null }, ad_accounts: [{ id: "ad-account-1", name: "Nelyon Ads", status: "active", billing_currency: "BDAG", is_default: true }] }, error: null })
      .mockResolvedValueOnce({ data: { campaigns: [{ id: "v2-1", name: "Brand", status: "draft", objective: "awareness", ad_account_id: "ad-account-1", business_account_id: "business-1", authority: "ads_v2", write_authority: "ads_v2", created_at: "2026-09-23T00:00:00Z" }] }, error: null })
      .mockResolvedValueOnce({ data: { id: "v2-1", ad_account_id: "ad-account-1", business_account_id: "business-1", name: "Brand", status: "draft", objective: "awareness", authority: "ads_v2", write_authority: "ads_v2", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z", archived_at: null, ad_sets: [{ id: "set-1", name: "Main", status: "draft", starts_at: null, ends_at: null, created_at: "2026-09-23T00:00:00Z", audience: { id: "audience-1", status: "draft", latest_version_number: 1 }, placement_selection: { id: "selection-1", status: "draft", latest_version_number: 1 } }], destinations: [] }, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;

    expect(await getAdvertiserAccounts(client)).toEqual([]);
    expect((await createAdvertiserBusinessAccount("Studio", client)).businessAccountId).toBe("business-1");
    expect((await getAdvertisingCampaigns(client))[0]).toMatchObject({ authority: "ads_v2", writeAuthority: "ads_v2" });
    expect((await getAdvertisingCampaign("v2-1", "ads_v2", client)).adSets[0]).toMatchObject({ audience: { id: "audience-1" }, placementSelection: { id: "selection-1" } });
    expect(rpc).toHaveBeenNthCalledWith(1, "get_my_advertiser_accounts");
    expect(rpc).toHaveBeenNthCalledWith(2, "create_my_business_account", expect.objectContaining({ p_display_name: "Studio" }));
    expect(rpc).toHaveBeenNthCalledWith(3, "get_my_advertising_campaigns");
    expect(rpc).toHaveBeenNthCalledWith(4, "get_my_advertising_campaign", { p_campaign_id: "v2-1", p_authority: "ads_v2" });
  });

  it("creates only a general draft and never calls funding, spend, settlement, activation, or delivery", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("33333333-3333-4333-8333-333333333333");
    const rpc = vi.fn().mockResolvedValue({ data: { id: "v2-1", ad_account_id: "ad-account-1", business_account_id: "business-1", name: "Brand", status: "draft", objective: "awareness", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z", archived_at: null, ad_sets: [], destinations: [] }, error: null });
    await createAdvertisingCampaignDraft({ adAccountId: "ad-account-1", name: "Brand", objective: "awareness" }, { rpc } as unknown as BusinessSupabaseClient);
    expect(rpc).toHaveBeenCalledWith("create_my_advertising_campaign_draft", {
      p_ad_account_id: "ad-account-1", p_name: "Brand", p_objective: "awareness", p_idempotency_key: "33333333-3333-4333-8333-333333333333",
    });
    expect(rpc.mock.calls.flat().join(" ")).not.toMatch(/fund_|spend_|settle_|activate|delivery_candidates|record_advertising/);
  });

  it("uses canonical server readiness and lifecycle RPCs without mutating status client-side", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("44444444-4444-4444-8444-444444444444");
    const readiness = {
      campaign_id: "v2-1", current_status: "draft", structurally_ready: false,
      activation_enabled: false, automatic_transitions_enabled: false, target_status: null,
      blockers: ["campaign_activation_disabled"], ready_ad_count: 0,
      current_window_ad_set_count: 0, future_window_ad_set_count: 0,
      finance_ready: false, advertiser_age_ready: true,
    };
    const campaignResult = { id: "v2-1", ad_account_id: "ad-account-1", business_account_id: "business-1", name: "Brand", status: "draft", objective: "awareness", authority: "ads_v2", write_authority: "ads_v2", created_at: "2026-09-23T00:00:00Z", updated_at: "2026-09-23T00:00:00Z", archived_at: null, lifecycle: { activation_enabled: false, automatic_transitions_enabled: false, requires_financial_settlement: false }, ad_sets: [], destinations: [] };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: readiness, error: null })
      .mockResolvedValue({ data: campaignResult, error: null });
    const client = { rpc } as unknown as BusinessSupabaseClient;

    expect(await getAdvertisingCampaignActivationReadiness("v2-1", client)).toMatchObject({
      campaignId: "v2-1", activationEnabled: false, blockers: ["campaign_activation_disabled"],
    });
    await activateAdvertisingCampaign("v2-1", client);
    await pauseAdvertisingCampaign("v2-1", client);
    await resumeAdvertisingCampaign("v2-1", client);
    await cancelAdvertisingCampaign("v2-1", client);

    expect(rpc).toHaveBeenNthCalledWith(1, "get_my_advertising_campaign_activation_readiness", { p_campaign_id: "v2-1" });
    expect(rpc).toHaveBeenNthCalledWith(2, "activate_my_advertising_campaign_v2", { p_campaign_id: "v2-1", p_idempotency_key: "44444444-4444-4444-8444-444444444444" });
    expect(rpc).toHaveBeenNthCalledWith(3, "pause_my_advertising_campaign_v2", { p_campaign_id: "v2-1", p_idempotency_key: "44444444-4444-4444-8444-444444444444" });
    expect(rpc).toHaveBeenNthCalledWith(4, "resume_my_advertising_campaign_v2", { p_campaign_id: "v2-1", p_idempotency_key: "44444444-4444-4444-8444-444444444444" });
    expect(rpc).toHaveBeenNthCalledWith(5, "cancel_my_advertising_campaign_v2", { p_campaign_id: "v2-1", p_idempotency_key: "44444444-4444-4444-8444-444444444444" });
  });

  it("parses canonical placement state for refresh-safe workspace restoration", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      placement_selection_id: "selection-1", ad_set_id: "set-1", status: "draft", production_delivery_enabled: false,
      latest_version: { version_number: 2, registry_policy_version: "nelyon-ads-delivery-v2", definition_fingerprint: "fingerprint", placements: [
        { code: "clips", label: "Clips", surface_family: "video", surface_verified: true, selection_enabled: true, v2_delivery_enabled: false },
      ] } },
      error: null,
    });
    const selection = await getAdvertisingPlacementSelection("selection-1", { rpc } as unknown as BusinessSupabaseClient);
    expect(selection.latestVersion?.placements).toEqual([expect.objectContaining({ code: "clips", v2DeliveryEnabled: false })]);
    expect(selection.productionDeliveryEnabled).toBe(false);
  });

  it("distinguishes a missing finance draft from authorization and transport failures", async () => {
    const missingRpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0002", message: "advertising_campaign_finance_not_found" } });
    const deniedRpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "advertising_campaign_finance_access_denied" } });
    let missing: unknown;
    try { await getAdvertisingFinance("campaign-1", { rpc: missingRpc } as unknown as BusinessSupabaseClient); } catch (cause) { missing = cause; }
    expect(isAdvertisingFinanceNotFound(missing)).toBe(true);
    await expect(getAdvertisingFinance("campaign-1", { rpc: deniedRpc } as unknown as BusinessSupabaseClient)).rejects.toThrow("advertising_campaign_finance_access_denied");
  });
});
