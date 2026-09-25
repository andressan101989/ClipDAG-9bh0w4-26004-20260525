import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdvertisingManagerProvider, BusinessAdsManagerCampaignPage, BusinessAdsManagerHomePage, BusinessAdsManagerNewCampaignPage } from "../pages/ads/BusinessAdsV2Pages";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
const authUser = vi.hoisted(() => ({ id: "owner-1", email: "owner@nelyon.app" }));
vi.mock("../auth/BusinessAuthProvider", () => ({ useBusinessAuth: () => ({ user: authUser }) }));
const api = vi.hoisted(() => ({
  accounts: vi.fn(), campaigns: vi.fn(), createBusiness: vi.fn(), createCampaign: vi.fn(),
  campaign: vi.fn(), readiness: vi.fn(), creativeWorkspace: vi.fn(), finance: vi.fn(), summary: vi.fn(), audience: vi.fn(), placement: vi.fn(),
  activate: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
  age: vi.fn(), remediateAge: vi.fn(),
  targetingCapabilities: vi.fn(), createAudienceVersion: vi.fn(),
  createAudience: vi.fn(),
}));
vi.mock("../lib/adsManagerApi", async (original) => ({
  ...await original<typeof import("../lib/adsManagerApi")>(),
  getAdvertiserAccounts: api.accounts,
  getAdvertisingCampaigns: api.campaigns,
  createAdvertiserBusinessAccount: api.createBusiness,
  createAdvertisingCampaignDraft: api.createCampaign,
  getAdvertisingCampaign: api.campaign,
  getAdvertisingCampaignActivationReadiness: api.readiness,
  activateAdvertisingCampaign: api.activate,
  pauseAdvertisingCampaign: api.pause,
  resumeAdvertisingCampaign: api.resume,
  cancelAdvertisingCampaign: api.cancel,
  getAdvertisingCreativeWorkspace: api.creativeWorkspace,
  getAdvertisingFinance: api.finance,
  getAdvertisingEventSummary: api.summary,
  getAdvertisingAudience: api.audience,
  getAdvertisingPlacementSelection: api.placement,
  getMyAgeEligibility: api.age,
  remediateMyAgeEligibility: api.remediateAge,
  getAdvertisingTargetingCapabilities: api.targetingCapabilities,
  createAdvertisingAudienceVersion: api.createAudienceVersion,
  createAdvertisingAudienceDraft: api.createAudience,
}));

const ownerBusiness = { businessAccountId: "business-1", displayName: "Nelyon Studio", status: "active", accessType: "owner", marketplace: { linked: false, marketplaceSellerUserId: null, sellerStatus: null }, adAccounts: [{ id: "account-1", name: "Nelyon Ads", status: "active", billingCurrency: "BDAG", isDefault: true }] };

function renderHome(path = "/ads") {
  return render(<MemoryRouter initialEntries={[path]}><AdvertisingManagerProvider><Routes><Route path="/ads" element={<BusinessAdsManagerHomePage />} /><Route path="/ads/campaigns/new" element={<BusinessAdsManagerNewCampaignPage />} /><Route path="/ads/campaigns/:campaignId" element={<BusinessAdsManagerCampaignPage />} /></Routes></AdvertisingManagerProvider></MemoryRouter>);
}

describe("Ads Manager V2 workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    api.accounts.mockResolvedValue([ownerBusiness]);
    api.campaigns.mockResolvedValue([]);
    api.createBusiness.mockResolvedValue(ownerBusiness);
    api.createCampaign.mockResolvedValue({ id: "campaign-1" });
    api.creativeWorkspace.mockResolvedValue({ creatives: [], ads: [] });
    api.readiness.mockResolvedValue({ campaignId: "campaign-1", currentStatus: "draft", structurallyReady: false, activationEnabled: false, automaticTransitionsEnabled: false, targetStatus: null, blockers: ["campaign_finance_not_funded"], readyAdCount: 0, currentWindowAdSetCount: 0, futureWindowAdSetCount: 0, financeReady: false, advertiserAgeReady: true });
    api.activate.mockResolvedValue({ id: "campaign-1", status: "active" });
    api.pause.mockResolvedValue({ id: "campaign-1", status: "paused" });
    api.resume.mockResolvedValue({ id: "campaign-1", status: "active" });
    api.cancel.mockResolvedValue({ id: "campaign-1", status: "cancelled" });
    api.finance.mockRejectedValue(new Error("advertising_campaign_finance_not_found"));
    api.summary.mockResolvedValue({ impressions: 0, clicks: 0, conversions: 0, ctr: 0 });
    api.audience.mockResolvedValue(null);
    api.placement.mockResolvedValue(null);
    api.age.mockResolvedValue({ status: "eligible", ageBand: "age_18_plus", evaluated: true, advertiser18PlusEligible: true, policyVersion: "nelyon-age-v2", minimumAge: 13 });
    api.remediateAge.mockResolvedValue({ status: "eligible", ageBand: "age_18_plus", evaluated: true, advertiser18PlusEligible: true, policyVersion: "nelyon-age-v2", minimumAge: 13 });
    api.targetingCapabilities.mockResolvedValue({ policyVersion: "nelyon-ads-targeting-v2", advertiserMinimumAge: 18, audienceMinimumAge: 18, ageScope: "adults_only", geoTargetingEnabled: false, languageTargetingEnabled: false, daypartTargetingEnabled: true, frequencyTargetingEnabled: true, interestTargetingEnabled: false, behavioralTargetingEnabled: false, customAudiencesEnabled: false, lookalikeTargetingEnabled: false, sensitiveTargetingAllowed: false, preciseViewerLocationMatchingEnabled: false });
    api.createAudienceVersion.mockResolvedValue({ audience_id: "audience-1" });
    api.createAudience.mockResolvedValue({ audience_id: "audience-1" });
  });

  it("offers advertiser-only onboarding without Marketplace seller, Store, or Product", async () => {
    api.accounts.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText("Create your business account")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Local Studio" } });
    fireEvent.click(screen.getByRole("button", { name: "Create business account" }));
    await waitFor(() => expect(api.createBusiness).toHaveBeenCalledWith("Local Studio", expect.any(String)));
  });

  it("keeps Business creation successful when the post-save refresh fails", async () => {
    api.accounts.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("refresh unavailable"));
    renderHome();
    expect(await screen.findByText("Create your business account")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Saved Studio" } });
    fireEvent.click(screen.getByRole("button", { name: "Create business account" }));

    expect(await screen.findByText("Business account created.")).toBeInTheDocument();
    expect(screen.getByText("Saved, but we couldn't refresh the latest view.")).toBeInTheDocument();
    expect(screen.queryByText("refresh unavailable")).not.toBeInTheDocument();
    expect(api.createBusiness).toHaveBeenCalledTimes(1);
  });

  it("offers self-service remediation for unknown eligibility and unlocks Ads after the server returns adult", async () => {
    api.age.mockResolvedValue({ status: "unknown_legacy", ageBand: "unknown_legacy", evaluated: false, advertiser18PlusEligible: false, policyVersion: "nelyon-age-v2", minimumAge: 13 });
    renderHome();
    expect(await screen.findByText("Confirm your age to continue with advertising.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create campaign" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1990-05-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm age" }));
    await waitFor(() => expect(api.remediateAge).toHaveBeenCalledWith("1990-05-10"));
    expect(await screen.findByRole("link", { name: "Create campaign" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("1990-05-10")).not.toBeInTheDocument();
  });

  it("keeps a server-classified teen blocked without exposing internal age authority", async () => {
    api.age.mockResolvedValue({ status: "eligible", ageBand: "age_13_17", evaluated: true, advertiser18PlusEligible: false, policyVersion: "nelyon-age-v2", minimumAge: 13 });
    renderHome();
    expect(await screen.findByText("Advertising is available only to adults 18 or older.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create campaign" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("age_13_17");
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

  it("locks a resumed workspace to the Campaign Business and Ad Account while enabling advertiser-owned Media", async () => {
    const campaignBusiness = { ...ownerBusiness, businessAccountId: "business-2", displayName: "Campaign Business", adAccounts: [{ ...ownerBusiness.adAccounts[0], id: "account-2", name: "Campaign Ads" }] };
    api.accounts.mockResolvedValue([ownerBusiness, campaignBusiness]);
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-2", businessAccountId: "business-2", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [], destinations: [] });
    renderHome("/ads/campaigns/campaign-1");
    expect(await screen.findByText("Brand")).toBeInTheDocument();
    expect(screen.getByLabelText("Business")).toHaveValue("business-2");
    expect(screen.getByLabelText("Ad Account")).toHaveValue("account-2");
    expect(screen.getByLabelText("Business")).toBeDisabled();
    expect(screen.getByLabelText("Ad Account")).toBeDisabled();
    expect(screen.queryByText(/Media Library is still Marketplace Business capability-scoped/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose from Media Library" })).toBeEnabled();
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

  it("renders server readiness, keeps activation locked by policy, and sends cancellation through the canonical RPC", async () => {
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, lifecycle: { activationEnabled: false, automaticTransitionsEnabled: false, requiresFinancialSettlement: false }, adSets: [], destinations: [] });
    renderHome("/ads/campaigns/campaign-1");
    const locked = await screen.findByRole("button", { name: "Activation locked" });
    expect(locked).toBeDisabled();
    expect(screen.getByText("campaign finance not funded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("campaign-1", expect.any(String)));
    expect(api.activate).not.toHaveBeenCalled();
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

  it("uses server targeting capabilities and never offers launch-disabled geo or language inputs", async () => {
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [{ id: "set-1", name: "Main", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-09-23T00:00:00Z", audience: null, placementSelection: null }], destinations: [] });
    renderHome("/ads/campaigns/campaign-1");
    expect(await screen.findByDisplayValue("Adults 18+")).toBeInTheDocument();
    expect(screen.getByText("Geographic targeting is not available in the current Ads launch scope.")).toBeInTheDocument();
    expect(screen.getByText("Language targeting is not available in the current Ads launch scope.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Country code")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Language tag")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Daypart start")).toBeEnabled();
    expect(screen.getByLabelText("Max impressions")).toBeEnabled();
  });

  it("marks a historical audience stale and creates a fresh version without rewriting it", async () => {
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [{ id: "set-1", name: "Main", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-09-23T00:00:00Z", audience: { id: "audience-1", status: "draft", latestVersionNumber: 1 }, placementSelection: null }], destinations: [] });
    api.audience.mockResolvedValue({ audience_id: "audience-1", latest_version: { targeting_policy_version: "nelyon-ads-targeting-v1", dayparts: [], frequency: null } });
    renderHome("/ads/campaigns/campaign-1");
    expect(await screen.findByText("Your audience configuration uses an older targeting policy. Create an updated audience version before launch.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create updated audience version" }));
    await waitFor(() => expect(api.createAudienceVersion).toHaveBeenCalledWith("audience-1", expect.objectContaining({ age_scope: "adults_only", geographies: [], languages: [] }), expect.any(String)));
  });

  it("coalesces a rapid Audience double submit and supplies one stable operation key", async () => {
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [{ id: "set-1", name: "Main", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-09-23T00:00:00Z", audience: null, placementSelection: null }], destinations: [] });
    let release!: (value: { audience_id: string }) => void;
    api.createAudience.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderHome("/ads/campaigns/campaign-1");
    const save = await screen.findByRole("button", { name: "Save Audience" });

    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(api.createAudience).toHaveBeenCalledTimes(1));
    expect(api.createAudience).toHaveBeenCalledWith("set-1", expect.objectContaining({ age_scope: "adults_only" }), expect.any(String));
    expect(save).toBeDisabled();
    expect(save).toHaveTextContent("Saving…");
    release({ audience_id: "audience-1" });
    expect(await screen.findByText("Audience created")).toBeInTheDocument();
  });

  it("uses the form submit as the single Audience trigger for the Enter key", async () => {
    const user = userEvent.setup();
    api.campaign.mockResolvedValue({ id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [{ id: "set-1", name: "Main", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-09-23T00:00:00Z", audience: null, placementSelection: null }], destinations: [] });
    let release!: (value: { audience_id: string }) => void;
    api.createAudience.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    renderHome("/ads/campaigns/campaign-1");
    const field = await screen.findByLabelText("Max impressions");

    await user.click(field);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.createAudience).toHaveBeenCalledTimes(1));
    expect(field.closest("form")).toHaveAttribute("aria-busy", "true");
    release({ audience_id: "audience-1" });
    expect(await screen.findByText("Audience created")).toBeInTheDocument();
  });

  it("reconciles a matching Audience idempotency conflict without showing the raw code", async () => {
    const withoutAudience = { id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [{ id: "set-1", name: "Main", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-09-23T00:00:00Z", audience: null, placementSelection: null }], destinations: [] };
    const withAudience = { ...withoutAudience, adSets: [{ ...withoutAudience.adSets[0], audience: { id: "audience-1", status: "draft", latestVersionNumber: 1 } }] };
    api.campaign.mockResolvedValueOnce(withoutAudience).mockResolvedValue(withAudience);
    api.audience.mockResolvedValue({ audience_id: "audience-1", latest_version: { age_scope: "adults_only", geographies: [], languages: [], dayparts: [], frequency: null, targeting_policy_version: "nelyon-ads-targeting-v2" } });
    api.createAudience.mockRejectedValue(new Error("advertising_audience_idempotency_conflict"));
    renderHome("/ads/campaigns/campaign-1");

    fireEvent.click(await screen.findByRole("button", { name: "Save Audience" }));

    expect(await screen.findByText("Already saved. We refreshed the saved version.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("advertising_audience_idempotency_conflict");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a committed mutation successful when the post-save refresh fails", async () => {
    const campaign = { id: "campaign-1", name: "Brand", status: "draft", objective: "awareness", adAccountId: "account-1", businessAccountId: "business-1", authority: "ads_v2", writeAuthority: "ads_v2", createdAt: "2026-09-23T00:00:00Z", updatedAt: null, archivedAt: null, adSets: [{ id: "set-1", name: "Main", status: "draft", startsAt: null, endsAt: null, createdAt: "2026-09-23T00:00:00Z", audience: null, placementSelection: null }], destinations: [] };
    api.campaign.mockResolvedValueOnce(campaign).mockRejectedValue(new Error("refresh_network_error"));
    renderHome("/ads/campaigns/campaign-1");
    fireEvent.click(await screen.findByRole("button", { name: "Save Audience" }));

    expect(await screen.findByText("Audience created")).toBeInTheDocument();
    expect(screen.getByText("Saved, but we couldn't refresh the latest view.")).toBeInTheDocument();
    expect(api.createAudience).toHaveBeenCalledTimes(1);
  });
});
