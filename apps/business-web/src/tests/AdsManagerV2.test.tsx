import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvertisingManagerProvider, BusinessAdsManagerCampaignPage, BusinessAdsManagerHomePage, BusinessAdsManagerNewCampaignPage } from "../pages/ads/BusinessAdsV2Pages";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../auth/BusinessAuthProvider", () => ({ useBusinessAuth: () => ({ user: { id: "owner-1", email: "owner@nelyon.app" } }) }));
const api = vi.hoisted(() => ({
  accounts: vi.fn(), campaigns: vi.fn(), createBusiness: vi.fn(), createCampaign: vi.fn(),
  campaign: vi.fn(), creativeWorkspace: vi.fn(), finance: vi.fn(), summary: vi.fn(), audience: vi.fn(), placement: vi.fn(),
}));
vi.mock("../lib/adsManagerApi", async (original) => ({
  ...await original<typeof import("../lib/adsManagerApi")>(),
  getAdvertiserAccounts: api.accounts,
  getAdvertisingCampaigns: api.campaigns,
  createAdvertiserBusinessAccount: api.createBusiness,
  createAdvertisingCampaignDraft: api.createCampaign,
  getAdvertisingCampaign: api.campaign,
  getAdvertisingCreativeWorkspace: api.creativeWorkspace,
  getAdvertisingFinance: api.finance,
  getAdvertisingEventSummary: api.summary,
  getAdvertisingAudience: api.audience,
  getAdvertisingPlacementSelection: api.placement,
}));

const ownerBusiness = { businessAccountId: "business-1", displayName: "Nelyon Studio", status: "active", accessType: "owner", marketplace: { linked: false, marketplaceSellerUserId: null, sellerStatus: null }, adAccounts: [{ id: "account-1", name: "Nelyon Ads", status: "active", billingCurrency: "BDAG", isDefault: true }] };

function renderHome(path = "/ads") {
  return render(<MemoryRouter initialEntries={[path]}><AdvertisingManagerProvider><Routes><Route path="/ads" element={<BusinessAdsManagerHomePage />} /><Route path="/ads/campaigns/new" element={<BusinessAdsManagerNewCampaignPage />} /><Route path="/ads/campaigns/:campaignId" element={<BusinessAdsManagerCampaignPage />} /></Routes></AdvertisingManagerProvider></MemoryRouter>);
}

describe("Ads Manager V2 workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.accounts.mockResolvedValue([ownerBusiness]);
    api.campaigns.mockResolvedValue([]);
    api.createBusiness.mockResolvedValue(ownerBusiness);
    api.createCampaign.mockResolvedValue({ id: "campaign-1" });
    api.creativeWorkspace.mockResolvedValue({ creatives: [], ads: [] });
    api.finance.mockRejectedValue(new Error("advertising_campaign_finance_not_found"));
    api.summary.mockResolvedValue({ impressions: 0, clicks: 0, conversions: 0, ctr: 0 });
    api.audience.mockResolvedValue(null);
    api.placement.mockResolvedValue(null);
  });

  it("offers advertiser-only onboarding without Marketplace seller, Store, or Product", async () => {
    api.accounts.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText("Create your business account")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Local Studio" } });
    fireEvent.click(screen.getByRole("button", { name: "Create business account" }));
    await waitFor(() => expect(api.createBusiness).toHaveBeenCalledWith("Local Studio"));
  });

  it("labels V2 and legacy campaigns and keeps legacy writes in the legacy workspace", async () => {
    api.campaigns.mockResolvedValue([
      { id: "v2", name: "Brand", objective: "awareness", status: "draft", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z" },
      { id: "legacy", name: "Product", objective: "marketplace_sales", status: "active", adAccountId: "account-1", businessAccountId: "business-1", authority: "marketplace_legacy", writeAuthority: "marketplace_legacy", createdAt: "2026-09-22T00:00:00Z" },
    ]);
    renderHome();
    expect(await screen.findByText("Brand")).toBeInTheDocument();
    expect(screen.getAllByText("ADS V2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MARKETPLACE LEGACY").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Open Product" })).toHaveAttribute("href", "/ads/marketplace/legacy");
  });

  it("keeps members read-only because V2 write RPCs remain owner-authoritative", async () => {
    api.accounts.mockResolvedValue([{ ...ownerBusiness, accessType: "member" }]);
    renderHome();
    expect(await screen.findByText(/owner-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create campaign" })).not.toBeInTheDocument();
  });

  it("locks a resumed workspace to the Campaign Business and Ad Account", async () => {
    const campaignBusiness = { ...ownerBusiness, businessAccountId: "business-2", displayName: "Campaign Business", adAccounts: [{ ...ownerBusiness.adAccounts[0], id: "account-2", name: "Campaign Ads" }] };
    api.accounts.mockResolvedValue([ownerBusiness, campaignBusiness]);
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-2", businessAccountId: "business-2", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [], destinations: [] });
    renderHome("/ads/campaigns/campaign-1");
    expect(await screen.findByText("Brand")).toBeInTheDocument();
    expect(screen.getByLabelText("Business")).toHaveValue("business-2");
    expect(screen.getByLabelText("Ad Account")).toHaveValue("account-2");
    expect(screen.getByLabelText("Business")).toBeDisabled();
    expect(screen.getByLabelText("Ad Account")).toBeDisabled();
    expect(screen.getByText(/Media Library is still Marketplace Business capability-scoped/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose from Media Library" })).toBeDisabled();
  });

  it("restores canonical placement codes in the assembled review after refresh", async () => {
    api.campaign.mockResolvedValue({
      id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null,
      adSets: [{ id: "set-1", name: "Main", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-09-23T00:00:00Z", audience: null, placementSelection: { id: "selection-1", status: "draft", latestVersionNumber: 1 } }],
      destinations: [{ id: "destination-1", destinationType: "external_url", externalUrl: "https://example.com", targetUserId: null, targetBusinessAccountId: null, targetProductId: null, targetStoreId: null, status: "draft", createdAt: "2026-09-23T00:00:00Z" }],
    });
    api.creativeWorkspace.mockResolvedValue({ creatives: [{ id: "creative-1", adAccountId: "account-1", name: "Creative", status: "draft", versions: [{ id: "version-1", versionNumber: 1, format: "image", mediaAssetId: "media-1", videoAssetId: null, primaryText: "Copy", headline: "Headline", description: null, callToAction: "learn_more", createdAt: "2026-09-23T00:00:00Z" }] }], ads: [{ id: "ad-1", name: "Ad", campaignId: "campaign-1", adSetId: "set-1", creativeVersionId: "version-1", destinationId: "destination-1", status: "draft", reviewStatus: "not_submitted", submittedAt: null, reviewedAt: null, latestRejectionReasonCode: null, latestRejectionMessage: null }] });
    api.placement.mockResolvedValue({ placementSelectionId: "selection-1", adSetId: "set-1", status: "draft", latestVersion: { versionNumber: 1, registryPolicyVersion: "nelyon-ads-delivery-v2", definitionFingerprint: "fp", placements: [{ code: "clips", label: "Clips", surfaceFamily: "video", surfaceVerified: true, selectionEnabled: true, v2DeliveryEnabled: false }, { code: "live", label: "Live", surfaceFamily: "live", surfaceVerified: true, selectionEnabled: true, v2DeliveryEnabled: false }] }, productionDeliveryEnabled: false });
    renderHome("/ads/campaigns/campaign-1");
    expect(await screen.findByText("Placements: clips, live")).toBeInTheDocument();
    expect(screen.queryByText("Placements: social_feed")).not.toBeInTheDocument();
  });

  it("does not treat a finance read failure as an absent budget draft", async () => {
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [], destinations: [] });
    api.finance.mockRejectedValue(new Error("network_unavailable"));
    renderHome("/ads/campaigns/campaign-1");
    expect(await screen.findByText("network_unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Define budget draft" })).not.toBeInTheDocument();
  });

  it("maps Campaign draft creation and renders the adult eligibility blocker safely", async () => {
    api.createCampaign.mockRejectedValue(new Error("advertising_adult_eligibility_required"));
    renderHome("/ads/campaigns/new");
    await screen.findByText("Create campaign draft");
    fireEvent.change(screen.getByLabelText("Campaign name"), { target: { value: "Brand awareness" } });
    fireEvent.click(screen.getByRole("button", { name: "Create draft" }));
    expect(await screen.findByText("Advertising creation requires verified adult eligibility.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/age_band|DOB|policy_version/);
  });
});
