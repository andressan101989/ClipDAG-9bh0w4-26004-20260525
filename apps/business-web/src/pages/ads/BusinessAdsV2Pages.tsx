/* eslint-disable react-refresh/only-export-components -- the workspace context and its route pages form one feature boundary */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { FormField, InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import { AudienceTargetingPanel } from "../../components/ads/AudienceTargetingPanel";
import { AdAssemblyPanel, CreativePanel } from "../../components/ads/CreativeAdPanels";
import { BusinessReviewPanel } from "../../components/ads/BusinessReviewPanel";
import { DestinationPanel, type DestinationValues } from "../../components/ads/DestinationPanel";
import { OperationalTruthPanels } from "../../components/ads/OperationalTruthPanels";
import { PlacementSelectionPanel } from "../../components/ads/PlacementSelectionPanel";
import { audienceCapabilitiesAreSafe } from "../../lib/audienceTargetingUx";
import { destinationLabel, externalWebsiteSummary, isCurrentReleaseDestination, isCurrentReleasePlacementSelection } from "../../lib/adsPlacementDestinationUx";
import { findAdOperationResult, isCreativeMediaSelectable, sameCreativeContent } from "../../lib/adsCreativeUx";
import { sameBudgetDecimal, validateBudgetDecimal } from "../../lib/adsOperationalTruth";
import { searchAllBusinessMedia, type BusinessMediaItem } from "../../lib/businessMediaApi";
import {
  ADVERTISING_OBJECTIVES,
  activateAdvertisingCampaign,
  advertisingUserMessage,
  cancelAdvertisingCampaign,
  createAdvertiserBusinessAccount,
  createAdvertisingAdDraft,
  createAdvertisingAdSetDraft,
  createAdvertisingAudienceDraft,
  createAdvertisingAudienceVersion,
  createAdvertisingCampaignDraft,
  createAdvertisingCreative,
  createAdvertisingCreativeVersion,
  createAdvertisingDestinationDraft,
  createAdvertisingFinanceDraft,
  createAdvertisingPlacementSelectionDraft,
  createAdvertisingPlacementSelectionVersion,
  getAdvertiserAccounts,
  getMyAgeEligibility,
  getAdvertisingAudience,
  getAdvertisingCampaign,
  getAdvertisingCampaignActivationReadiness,
  getAdvertisingCampaigns,
  getAdvertisingCreativeWorkspace,
  getAdvertisingEventSummary,
  getAdvertisingFinance,
  getAdvertisingPlacementSelection,
  getAdvertisingTargetingCapabilities,
  isAdvertisingFinanceNotFound,
  pauseAdvertisingCampaign,
  remediateMyAgeEligibility,
  resumeAdvertisingCampaign,
  submitAdvertisingAdForReview,
  updateAdvertisingAdSetDraft,
  updateAdvertisingDestinationDraft,
  type AdvertiserAdAccount,
  type AdvertiserBusiness,
  type AdvertisingAudienceDefinition,
  type AdvertisingAgeEligibility,
  type AdvertisingCampaign,
  type AdvertisingCampaignReadiness,
  type AdvertisingCampaignSummary,
  type AdvertisingCreativeWorkspace,
  type AdvertisingFinance,
  type AdvertisingPlacementSelection,
  type AdvertisingTargetingCapabilities,
} from "../../lib/adsManagerApi";
import { formatDate } from "../../lib/businessFormat";
import { adsMutationCoordinator, areAdsMutationPayloadsEquivalent, type AdsMutationReconciliation, type AdsMutationRunInput } from "../../lib/adsMutationCoordinator";
import { useAdsMutationCoordinator } from "../../lib/useAdsMutationCoordinator";
import { deriveAdsWorkflow, resolveWorkspaceSelection } from "../../lib/adsWorkflowState";

const mutationApplied = <T,>(value: T): AdsMutationReconciliation<T> => ({ status: "applied_as_intended", value });
const mutationNotApplied = <T,>(): AdsMutationReconciliation<T> => ({ status: "not_applied" });
const mutationDifferent = <T,>(): AdsMutationReconciliation<T> => ({ status: "applied_differently" });

function sameStrings(left: string[], right: string[]) {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function audienceDefinitionFromPayload(payload: Record<string, unknown> | null): AdvertisingAudienceDefinition | null {
  if (!payload) return null;
  const latest = payload.latest_version && typeof payload.latest_version === "object"
    ? payload.latest_version as Record<string, unknown>
    : null;
  if (!latest) return null;
  return {
    age_scope: "adults_only",
    geographies: Array.isArray(latest.geographies) ? latest.geographies as AdvertisingAudienceDefinition["geographies"] : [],
    languages: Array.isArray(latest.languages) ? latest.languages as AdvertisingAudienceDefinition["languages"] : [],
    dayparts: Array.isArray(latest.dayparts) ? latest.dayparts as AdvertisingAudienceDefinition["dayparts"] : [],
    frequency: latest.frequency && typeof latest.frequency === "object" ? latest.frequency as AdvertisingAudienceDefinition["frequency"] : null,
  };
}

function sameAudienceDefinition(left: AdvertisingAudienceDefinition | null, right: AdvertisingAudienceDefinition) {
  return left != null && areAdsMutationPayloadsEquivalent(left, right);
}

type AdvertisingManagerState = {
  accounts: AdvertiserBusiness[];
  campaigns: AdvertisingCampaignSummary[];
  selectedBusiness: AdvertiserBusiness | null;
  selectedAdAccount: AdvertiserAdAccount | null;
  loading: boolean;
  error: string | null;
  ageEligibility: AdvertisingAgeEligibility | null;
  targetingCapabilities: AdvertisingTargetingCapabilities | null;
  targetingCapabilitiesUnavailable: boolean;
  selectBusiness: (id: string) => void;
  selectAdAccount: (id: string) => void;
  createBusiness: (name: string) => Promise<{ refreshWarning: string | null }>;
  remediateAge: (dateOfBirth: string) => Promise<AdvertisingAgeEligibility>;
  refresh: () => Promise<boolean>;
};

const AdvertisingManagerContext = createContext<AdvertisingManagerState | null>(null);

export function AdvertisingManagerProvider({ children }: { children: ReactNode }) {
  const { user } = useBusinessAuth();
  const [accounts, setAccounts] = useState<AdvertiserBusiness[]>([]);
  const [campaigns, setCampaigns] = useState<AdvertisingCampaignSummary[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState("");
  const [selectedAdAccountId, setSelectedAdAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ageEligibility, setAgeEligibility] = useState<AdvertisingAgeEligibility | null>(null);
  const [targetingCapabilities, setTargetingCapabilities] = useState<AdvertisingTargetingCapabilities | null>(null);
  const [targetingCapabilitiesUnavailable, setTargetingCapabilitiesUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return false;
    setLoading(true); setError(null);
    try {
      const [nextAccounts, nextCampaigns, nextAgeEligibility, targetingResult] = await Promise.all([
        getAdvertiserAccounts(),
        getAdvertisingCampaigns(),
        getMyAgeEligibility(),
        getAdvertisingTargetingCapabilities().then((value) => ({ value, unavailable: false })).catch(() => ({ value: null, unavailable: true })),
      ]);
      setAccounts(nextAccounts); setCampaigns(nextCampaigns);
      setAgeEligibility(nextAgeEligibility);
      setTargetingCapabilities(targetingResult.value);
      setTargetingCapabilitiesUnavailable(targetingResult.unavailable);
      setSelectedBusinessId((current) => nextAccounts.some((item) => item.businessAccountId === current) ? current : nextAccounts[0]?.businessAccountId ?? "");
      return true;
    } catch (cause) { setError(advertisingUserMessage(cause)); return false; }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);
  const selectedBusiness = accounts.find((item) => item.businessAccountId === selectedBusinessId) ?? accounts[0] ?? null;
  const selectedAdAccount = selectedBusiness?.adAccounts.find((item) => item.id === selectedAdAccountId)
    ?? selectedBusiness?.adAccounts.find((item) => item.isDefault) ?? selectedBusiness?.adAccounts[0] ?? null;
  useEffect(() => { setSelectedAdAccountId(selectedAdAccount?.id ?? ""); }, [selectedBusinessId, selectedAdAccount?.id]);

  const createBusiness = useCallback(async (name: string) => {
    const displayName = name.trim();
    const result = await adsMutationCoordinator.run({
      operation: "business:create",
      scope: user?.id ?? "current-user",
      payload: { displayName },
      mutate: (key) => createAdvertiserBusinessAccount(displayName, key),
      reconcile: async () => {
        const current = await getAdvertiserAccounts();
        const match = current.find((item) => item.displayName === displayName);
        return match ? mutationApplied(match) : mutationNotApplied();
      },
    });
    if (result.state !== "success") throw new Error(result.message);
    const refreshed = await refresh();
    if (!refreshed) setError(null);
    return { refreshWarning: refreshed ? null : "Saved, but we couldn't refresh the latest view." };
  }, [refresh, user?.id]);

  const remediateAge = useCallback(async (dateOfBirth: string) => {
    const result = await remediateMyAgeEligibility(dateOfBirth);
    setAgeEligibility(result);
    return result;
  }, []);

  const value = useMemo<AdvertisingManagerState>(() => ({ accounts, campaigns, selectedBusiness, selectedAdAccount, loading, error, ageEligibility, targetingCapabilities, targetingCapabilitiesUnavailable, selectBusiness: setSelectedBusinessId, selectAdAccount: setSelectedAdAccountId, createBusiness, remediateAge, refresh }), [accounts, campaigns, selectedBusiness, selectedAdAccount, loading, error, ageEligibility, targetingCapabilities, targetingCapabilitiesUnavailable, createBusiness, remediateAge, refresh]);
  return <AdvertisingManagerContext.Provider value={value}>{children}</AdvertisingManagerContext.Provider>;
}

function AdvertisingAgeEligibilityPanel() {
  const { ageEligibility, remediateAge } = useAdvertisingManager();
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ageEligibility || ageEligibility.advertiser18PlusEligible) return null;
  if (ageEligibility.evaluated) {
    return <section id="age-eligibility" className="business-card ads-v2-age-gate" role="status">
      <strong>{ageEligibility.ageBand === "age_13_17" ? "Advertising is available only to adults 18 or older." : "This account is not eligible to use advertising."}</strong>
      <span>Eligibility is enforced by the canonical server authority.</span>
    </section>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      await remediateAge(dateOfBirth);
      setDateOfBirth("");
    } catch (cause) {
      setError(advertisingUserMessage(cause));
    } finally { setSaving(false); }
  }

  return <section id="age-eligibility" className="business-card ads-v2-age-gate">
    <strong>Confirm your age to continue with advertising.</strong>
    <p>Your date of birth is sent to the server only to determine eligibility. Ads Manager does not store it.</p>
    <InlineError message={error} />
    <form className="seller-form" onSubmit={(event) => void submit(event)}>
      <FormField label="Date of birth"><input type="date" required value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></FormField>
      <button className="primary-button" disabled={saving} type="submit">{saving ? "Confirming…" : "Confirm age"}</button>
    </form>
  </section>;
}

export function useAdvertisingManager() {
  const value = useContext(AdvertisingManagerContext);
  if (!value) throw new Error("AdvertisingManagerProvider required");
  return value;
}

function AccountSelectors({ business: lockedBusiness, adAccount: lockedAdAccount, locked = false }: { business?: AdvertiserBusiness | null; adAccount?: AdvertiserAdAccount | null; locked?: boolean } = {}) {
  const { accounts, selectedBusiness, selectedAdAccount, selectBusiness, selectAdAccount } = useAdvertisingManager();
  const business = locked ? lockedBusiness ?? null : selectedBusiness;
  const adAccount = locked ? lockedAdAccount ?? null : selectedAdAccount;
  return <div className="ads-v2-account-bar">
    <FormField label="Business"><select disabled={locked} value={business?.businessAccountId ?? ""} onChange={(event) => selectBusiness(event.target.value)}>{(locked && business ? [business] : accounts).map((item) => <option key={item.businessAccountId} value={item.businessAccountId}>{item.displayName}</option>)}</select></FormField>
    <FormField label="Ad Account"><select disabled={locked} value={adAccount?.id ?? ""} onChange={(event) => selectAdAccount(event.target.value)}>{(locked ? business?.adAccounts.filter((item) => item.id === adAccount?.id) : business?.adAccounts)?.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.billingCurrency}</option>)}</select></FormField>
    <span className="ads-v2-prelaunch-badge">PRE-LAUNCH</span>
  </div>;
}

function AdvertiserOnboarding() {
  const { createBusiness } = useAdvertisingManager();
  const [name, setName] = useState(""); const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ kind: "idle" } | { kind: "success"; warning: string | null } | { kind: "error"; message: string }>({ kind: "idle" });
  async function submit(event: React.FormEvent) { event.preventDefault(); if (saving) return; setSaving(true); setResult({ kind: "idle" }); try { const outcome = await createBusiness(name); setResult({ kind: "success", warning: outcome.refreshWarning }); } catch (cause) { setResult({ kind: "error", message: advertisingUserMessage(cause) }); } finally { setSaving(false); } }
  return <section className="business-card ads-v2-onboarding"><p className="eyebrow">Advertiser identity</p><h2>Create your business account</h2><p>You can advertise without becoming a Marketplace seller or creating a Store or Product.</p>{result.kind === "error" && <InlineError message={result.message} />}{result.kind === "success" && <div className="inline-success" role="status">Business account created.</div>}{result.kind === "success" && result.warning && <div className="readonly-note" role="status">{result.warning}</div>}<form className="seller-form" aria-busy={saving} onSubmit={(event) => void submit(event)}><FormField label="Business name"><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></FormField><button className="primary-button" disabled={saving} type="submit">{saving ? "Creating…" : "Create business account"}</button></form></section>;
}

export function BusinessAdsManagerHomePage() {
  const { accounts, campaigns, selectedBusiness, selectedAdAccount, loading, error, ageEligibility } = useAdvertisingManager();
  const visible = campaigns.filter((item) => item.businessAccountId === selectedBusiness?.businessAccountId && (!item.adAccountId || item.adAccountId === selectedAdAccount?.id));
  const owner = selectedBusiness?.accessType === "owner";
  return <>
    <PageHeader eyebrow="Business Ads Manager V2" title="Ads Manager" description="Build campaigns, creative, review, audience and budget drafts in one resumable workspace." action={owner && ageEligibility?.advertiser18PlusEligible ? <Link className="primary-button" to="/ads/campaigns/new">Create campaign</Link> : undefined} />
    <InlineError message={error} />
    {loading && <div className="seller-state">Loading advertiser accounts…</div>}
    {!loading && accounts.length === 0 && <AdvertiserOnboarding />}
    {!loading && accounts.length > 0 && <>
      <AccountSelectors />
      {owner && <AdvertisingAgeEligibilityPanel />}
      {!owner && <div className="readonly-note">Ads V2 campaign reads and writes are currently owner-only. Member access remains unsupported by the canonical campaign RPCs.</div>}
      <section className="business-card ads-v2-safety"><strong>Safe pre-launch workspace</strong><span>Campaign activation, funding and live delivery are unavailable. All placements remain delivery inactive.</span></section>
      <div className="seller-subnav"><Link className="is-active" to="/ads/campaigns">Campaigns</Link>{selectedBusiness?.marketplace.linked && <Link to="/ads/marketplace">Marketplace Legacy</Link>}</div>
      {visible.length === 0 ? <div className="seller-state"><strong>No campaigns yet</strong><p>Create an Ads V2 draft or open the existing Marketplace Ads workspace.</p></div> : <div className="seller-table-wrap"><table className="seller-table ads-v2-table"><thead><tr><th>Name</th><th>Objective</th><th>Authority</th><th>Status</th><th>Review</th><th>Budget</th><th>Created</th></tr></thead><tbody>{visible.map((campaign) => <tr key={`${campaign.authority}:${campaign.id}`}><td><Link aria-label={`Open ${campaign.name}`} to={campaign.authority === "ads_v2" ? `/ads/campaigns/${campaign.id}` : `/ads/marketplace/${campaign.id}`}>{campaign.name}</Link></td><td>{campaign.objective}</td><td><span className={`authority-badge ${campaign.authority}`}>{campaign.authority === "ads_v2" ? "ADS V2" : "MARKETPLACE LEGACY"}</span></td><td><StatusBadge status={campaign.status} /></td><td>{campaign.authority === "ads_v2" ? "Open workspace" : "Legacy authority"}</td><td>{campaign.authority === "ads_v2" ? "Draft state" : "Legacy finance"}</td><td>{formatDate(campaign.createdAt)}</td></tr>)}</tbody></table></div>}
    </>}
  </>;
}

export function BusinessAdsManagerNewCampaignPage() {
  const { accounts, selectedBusiness, selectedAdAccount, ageEligibility } = useAdvertisingManager();
  const navigate = useNavigate();
  const [name, setName] = useState(""); const [objective, setObjective] = useState<(typeof ADVERTISING_OBJECTIVES)[number]>("awareness");
  const mutation = useAdsMutationCoordinator();
  const owner = selectedBusiness?.accessType === "owner";
  const canWrite = owner && ageEligibility?.advertiser18PlusEligible === true;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canWrite || !selectedAdAccount || mutation.pending) return;
    const payload = { adAccountId: selectedAdAccount.id, name: name.trim(), objective };
    await mutation.run<{ id: string }>({
      operation: "campaign:create",
      scope: selectedAdAccount.id,
      payload,
      mutate: (key) => createAdvertisingCampaignDraft(payload, key),
      reconcile: async () => {
        const campaigns = await getAdvertisingCampaigns();
        const match = campaigns.find((item) => item.adAccountId === payload.adAccountId && item.name === payload.name && item.objective === payload.objective);
        const different = campaigns.some((item) => item.adAccountId === payload.adAccountId && item.name === payload.name);
        return match ? mutationApplied(match) : different ? mutationDifferent() : mutationNotApplied();
      },
    }, {
      successMessage: "Campaign draft created",
      errorMessage: advertisingUserMessage,
      afterSuccess: (campaign) => { navigate(`/ads/campaigns/${campaign.id}`); },
    });
  }
  if (accounts.length === 0) return <><PageHeader eyebrow="Ads Manager" title="Create campaign draft" description="Create a Business Account first." /><AdvertiserOnboarding /></>;
  const mutationError = mutation.state.kind === "error" || mutation.state.kind === "conflict" || mutation.state.kind === "uncertain" ? mutation.state.message : null;
  return <><PageHeader eyebrow="Ads Manager · Step 1" title="Create campaign draft" description="This creates a general Ads V2 draft. It does not fund, activate, or deliver advertising." action={<Link className="text-button" to="/ads">Back</Link>} /><AccountSelectors /><InlineError message={mutationError} />{mutation.state.kind === "success" && <div className="inline-success" role="status">{mutation.state.message}</div>}{owner && <AdvertisingAgeEligibilityPanel />}{!owner && <div className="readonly-note">Only the Business Account owner can create Ads V2 drafts.</div>}<form className="business-card ads-v2-compact-form" aria-busy={mutation.pending} onSubmit={(event) => void submit(event)}><FormField label="Campaign name"><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Objective"><select value={objective} onChange={(event) => setObjective(event.target.value as (typeof ADVERTISING_OBJECTIVES)[number])}>{ADVERTISING_OBJECTIVES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></FormField><FormField label="Ad Account"><input readOnly value={selectedAdAccount?.name ?? ""} /></FormField><button className="primary-button" type="submit" disabled={!canWrite || !selectedAdAccount || mutation.pending}>{mutation.pending ? "Creating…" : "Create draft"}</button></form></>;
}

type WorkspaceData = { requestKey: string; campaign: AdvertisingCampaign; readiness: AdvertisingCampaignReadiness; creatives: AdvertisingCreativeWorkspace; finance: AdvertisingFinance | null; analytics: Record<string, unknown>; audience: Record<string, unknown> | null; placement: AdvertisingPlacementSelection | null; selectedAdSetId: string | null; selectedDestinationId: string | null; selectedAdId: string | null };

const datetimeLocalValue = (value: string | null) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
const sameInstant = (left: string | null, right: string | null) => left === right || Boolean(left && right && Date.parse(left) === Date.parse(right));

export function BusinessAdsManagerCampaignPage() {
  const { campaignId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedAdSetId = searchParams.get("adSet");
  const requestedDestinationId = searchParams.get("destination");
  const requestedAdId = searchParams.get("ad");
  const workspaceQueryKey = `${campaignId}|${requestedAdSetId ?? ""}|${requestedDestinationId ?? ""}|${requestedAdId ?? ""}`;
  const workspaceQueryKeyRef = useRef(workspaceQueryKey);
  workspaceQueryKeyRef.current = workspaceQueryKey;
  const { accounts, refresh: refreshList, ageEligibility } = useAdvertisingManager();
  const [data, setData] = useState<WorkspaceData | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const mutation = useAdsMutationCoordinator();
  const campaignBusiness = data ? accounts.find((item) => item.businessAccountId === data.campaign.businessAccountId) ?? null : null;
  const campaignAdAccount = data ? campaignBusiness?.adAccounts.find((item) => item.id === data.campaign.adAccountId) ?? null : null;
  const owner = campaignBusiness?.accessType === "owner";
  const canWrite = owner && ageEligibility?.advertiser18PlusEligible === true;
  const fetchWorkspace = useCallback(async (): Promise<WorkspaceData> => {
    const campaign = await getAdvertisingCampaign(campaignId, "ads_v2");
    const adSet = resolveWorkspaceSelection(campaign.adSets, requestedAdSetId).selected;
    const [readiness, creatives, finance, analytics, audience, placement] = await Promise.all([
      getAdvertisingCampaignActivationReadiness(campaignId),
      getAdvertisingCreativeWorkspace(),
      getAdvertisingFinance(campaignId).catch((cause) => {
        if (isAdvertisingFinanceNotFound(cause)) return null;
        throw cause;
      }),
      getAdvertisingEventSummary(campaignId),
      adSet?.audience ? getAdvertisingAudience(adSet.audience.id) : Promise.resolve(null),
      adSet?.placementSelection ? getAdvertisingPlacementSelection(adSet.placementSelection.id) : Promise.resolve(null),
    ]);
    const destination = resolveWorkspaceSelection(campaign.destinations, requestedDestinationId).selected;
    const campaignAds = creatives.ads.filter((ad) => ad.campaignId === campaign.id && ad.adSetId === adSet?.id && ad.destinationId === destination?.id);
    return {
      requestKey: workspaceQueryKey, campaign, readiness, creatives, finance, analytics, audience, placement,
      selectedAdSetId: adSet?.id ?? null,
      selectedDestinationId: destination?.id ?? null,
      selectedAdId: resolveWorkspaceSelection(campaignAds, requestedAdId).selected?.id ?? null,
    };
  }, [campaignId, requestedAdSetId, requestedDestinationId, requestedAdId, workspaceQueryKey]);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(null);
    void fetchWorkspace()
      .then((workspace) => { if (current) setData(workspace); })
      .catch((cause) => { if (current) setError(advertisingUserMessage(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [fetchWorkspace]);
  useEffect(() => {
    if (!data || data.campaign.id !== campaignId || data.requestKey !== workspaceQueryKey) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    const campaignAds = data.creatives.ads.filter((ad) => ad.campaignId === data.campaign.id && ad.adSetId === data.selectedAdSetId && ad.destinationId === data.selectedDestinationId);
    for (const [key, rows] of [["adSet", data.campaign.adSets as Array<{ id: string }>], ["destination", data.campaign.destinations as Array<{ id: string }>], ["ad", campaignAds as Array<{ id: string }>]] as const) {
      const resolved = resolveWorkspaceSelection(rows, next.get(key));
      if (resolved.reason === "invalid") { next.delete(key); changed = true; }
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [campaignId, data, searchParams, setSearchParams, workspaceQueryKey]);
  async function run<T>(input: AdsMutationRunInput<T>, message: string, onSuccessValue?: (value: T) => void) {
    const operationQueryKey = workspaceQueryKey;
    const result = await mutation.run(input, {
      successMessage: message,
      errorMessage: advertisingUserMessage,
      afterError: async (cause) => {
        const code = cause instanceof Error ? cause.message : String(cause);
        if (!code.includes("advertising_ad_set_draft_stale") && !code.includes("advertising_destination_draft_stale")) return;
        const workspace = await fetchWorkspace();
        if (workspaceQueryKeyRef.current === operationQueryKey && workspace.requestKey === operationQueryKey) setData(workspace);
        return "This draft changed in another session. We loaded the latest version.";
      },
      afterSuccess: async (value) => {
        onSuccessValue?.(value);
        const [workspace] = await Promise.all([fetchWorkspace(), refreshList()]);
        if (workspaceQueryKeyRef.current === operationQueryKey && workspace.requestKey === operationQueryKey) setData(workspace);
      },
    });
    return result?.state === "success";
  }
  if (loading) return <div className="seller-state">Restoring campaign workspace from server…</div>;
  if (!data) return <><InlineError message={error} /><Link to="/ads">Back to campaigns</Link></>;
  const mutationError = mutation.state.kind === "error" || mutation.state.kind === "conflict" || mutation.state.kind === "uncertain" ? mutation.state.message : null;
  const selectEntity = (key: "adSet" | "destination" | "ad", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key === "adSet" || key === "destination") next.delete("ad");
    next.delete("adMode");
    setSearchParams(next);
  };
  const setRevisedAdMode = (enabled: boolean, selectedAdId?: string) => {
    const next = new URLSearchParams(searchParams);
    if (enabled) next.set("adMode", "revised"); else next.delete("adMode");
    if (selectedAdId) next.set("ad", selectedAdId);
    setSearchParams(next);
  };
  return <><PageHeader eyebrow="Ads V2 draft workspace" title={data.campaign.name} description="Server-backed configuration. Refreshing this page reconstructs Audience, Placements, Creative, Review, Finance and Analytics." action={<Link className="text-button" to="/ads">Back to campaigns</Link>} /><InlineError message={error ?? mutationError} />{mutation.state.kind === "success" && <div className="inline-success" role="status">{mutation.state.message}</div>}{mutation.refreshWarning && <div className="readonly-note" role="status">{mutation.refreshWarning}</div>}{owner && <AdvertisingAgeEligibilityPanel />}{!owner && <div className="readonly-note">This campaign is not writable by the current owner-authoritative Ads V2 RPCs.</div>}<AccountSelectors business={campaignBusiness} adAccount={campaignAdAccount} locked /><CampaignWorkspace data={data} business={campaignBusiness} adAccount={campaignAdAccount} owner={canWrite} run={run} reload={fetchWorkspace} pending={mutation.pending} selectEntity={selectEntity} creatingRevisedAd={searchParams.get("adMode") === "revised"} setRevisedAdMode={setRevisedAdMode} /></>;
}

function CampaignWorkspace({ data, business, adAccount, owner, run, reload, pending, selectEntity, creatingRevisedAd, setRevisedAdMode }: { data: WorkspaceData; business: AdvertiserBusiness | null; adAccount: AdvertiserAdAccount | null; owner: boolean; run: <T>(input: AdsMutationRunInput<T>, message: string, onSuccessValue?: (value: T) => void) => Promise<boolean>; reload: () => Promise<WorkspaceData>; pending: boolean; selectEntity: (key: "adSet" | "destination" | "ad", value: string) => void; creatingRevisedAd: boolean; setRevisedAdMode: (enabled: boolean, selectedAdId?: string) => void }) {
  const { user } = useBusinessAuth();
  const { targetingCapabilities, targetingCapabilitiesUnavailable } = useAdvertisingManager();
  const campaign = data.campaign;
  const adSet = campaign.adSets.find((item) => item.id === data.selectedAdSetId);
  const destination = campaign.destinations.find((item) => item.id === data.selectedDestinationId);
  const campaignAds = data.creatives.ads.filter((item) => item.campaignId === campaign.id && item.adSetId === adSet?.id && item.destinationId === destination?.id);
  const ad = campaignAds.find((item) => item.id === data.selectedAdId);
  const accountCreatives = data.creatives.creatives.filter((creative) => creative.adAccountId === campaign.adAccountId && creative.status === "draft");
  const allVersions = accountCreatives.flatMap((creative) => creative.versions.map((version) => ({ ...version, creativeName: creative.name })));
  const [adSetName, setAdSetName] = useState("Primary Ad Set"); const [startsAt, setStartsAt] = useState(""); const [endsAt, setEndsAt] = useState("");
  const [mediaById, setMediaById] = useState<Record<string, BusinessMediaItem>>({});
  const [editingAdSet, setEditingAdSet] = useState(false);
  const creativeMediaIds = useMemo(() => [...new Set(allVersions.flatMap((version) => [version.mediaAssetId, version.videoAssetId]).filter((id): id is string => Boolean(id)))].sort(), [allVersions]);
  const creativeMediaKey = creativeMediaIds.join("|");
  const businessOwnerId = business?.marketplace.marketplaceSellerUserId ?? user?.id;
  useEffect(() => {
    let current = true;
    if (!businessOwnerId || creativeMediaIds.length === 0) { setMediaById({}); return () => { current = false; }; }
    void searchAllBusinessMedia(businessOwnerId, { assetIds: creativeMediaIds, limit: 50, status: "ready" })
      .then((items) => { if (current) setMediaById(Object.fromEntries(items.filter(isCreativeMediaSelectable).map((item) => [item.assetId, item]))); })
      .catch(() => { if (current) setMediaById({}); });
    return () => { current = false; };
  // The stable joined key avoids re-fetching because the versions array is reconstructed during render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessOwnerId, creativeMediaKey]);
  const persistedPlacements = data.placement?.latestVersion?.placements.map((item) => item.code) ?? [];
  const destinationIsUsable = isCurrentReleaseDestination(destination ?? null);
  const audienceLatest = data.audience?.latest_version && typeof data.audience.latest_version === "object" ? data.audience.latest_version as Record<string, unknown> : null;
  const audienceDefinition = useMemo(() => audienceDefinitionFromPayload(data.audience), [data.audience]);
  const audienceIsStale = Boolean(audienceLatest && targetingCapabilities && audienceLatest.targeting_policy_version !== targetingCapabilities.policyVersion);
  useEffect(() => { if (adSet) { setAdSetName(adSet.name); setStartsAt(datetimeLocalValue(adSet.startsAt)); setEndsAt(datetimeLocalValue(adSet.endsAt)); setEditingAdSet(false); } }, [adSet]);
  const workflow = deriveAdsWorkflow({
    campaign: { exists: true, status: campaign.status },
    adSet: { selected: Boolean(adSet), count: campaign.adSets.length, status: adSet?.status ?? null, scheduleValid: !adSet || ((!adSet.startsAt && !adSet.endsAt) || Boolean(adSet.startsAt && adSet.endsAt && Date.parse(adSet.startsAt) < Date.parse(adSet.endsAt))) },
    audience: { exists: Boolean(data.audience), valid: Boolean(audienceLatest), policyCurrent: audienceCapabilitiesAreSafe(targetingCapabilities) && !audienceIsStale },
    placements: { exists: Boolean(data.placement?.latestVersion), valid: isCurrentReleasePlacementSelection(persistedPlacements) },
    destination: { selected: Boolean(destination), count: campaign.destinations.length, valid: destination?.status === "draft" && destinationIsUsable },
    creative: { exists: accountCreatives.length > 0, usable: allVersions.length > 0 },
    ad: { selected: Boolean(ad), count: campaignAds.length, status: ad?.status ?? null, reviewStatus: ad?.reviewStatus ?? null },
    finance: { exists: Boolean(data.finance), valid: Boolean(data.finance && validateBudgetDecimal(String(data.finance.budgetBdag)).valid) },
    readiness: { structurallyReady: data.readiness.structurallyReady, activationEnabled: data.readiness.activationEnabled, blockers: data.readiness.blockers },
  });
  const statusLabel = (status: string) => status.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  async function reconcileWorkspace<T>(match: (workspace: WorkspaceData) => T | null, hasDifferent: (workspace: WorkspaceData) => boolean): Promise<AdsMutationReconciliation<T>> {
    const workspace = await reload();
    const matched = match(workspace);
    if (matched) return mutationApplied(matched);
    return hasDifferent(workspace) ? mutationDifferent() : mutationNotApplied();
  }
  async function createBudgetDraft(budgetBdag: string) {
    return run({
      operation: "finance:create",
      scope: campaign.id,
      payload: { campaignId: campaign.id, budgetBdag },
      mutate: (key) => createAdvertisingFinanceDraft(campaign.id, budgetBdag, key),
      reconcile: () => reconcileWorkspace(
        (workspace) => workspace.finance?.campaignId === campaign.id && sameBudgetDecimal(workspace.finance.budgetBdag, budgetBdag) ? workspace.finance : null,
        (workspace) => workspace.finance != null,
      ),
    }, "Budget saved");
  }
  async function runLifecycleAction(action: "activate" | "pause" | "resume" | "cancel") {
    if (action === "activate") return run({ operation: "lifecycle:activate", scope: campaign.id, payload: { campaignId: campaign.id, action }, mutate: (key) => activateAdvertisingCampaign(campaign.id, key), reconcile: () => reconcileWorkspace((workspace) => ["active", "scheduled"].includes(workspace.campaign.status) ? workspace.campaign : null, (workspace) => ["completed", "cancelled"].includes(workspace.campaign.status)) }, "Campaign activated");
    if (action === "pause") return run({ operation: "lifecycle:pause", scope: campaign.id, payload: { campaignId: campaign.id, action }, mutate: (key) => pauseAdvertisingCampaign(campaign.id, key), reconcile: () => reconcileWorkspace((workspace) => workspace.campaign.status === "paused" ? workspace.campaign : null, (workspace) => ["completed", "cancelled"].includes(workspace.campaign.status)) }, "Campaign paused");
    if (action === "resume") return run({ operation: "lifecycle:resume", scope: campaign.id, payload: { campaignId: campaign.id, action }, mutate: (key) => resumeAdvertisingCampaign(campaign.id, key), reconcile: () => reconcileWorkspace((workspace) => ["active", "scheduled"].includes(workspace.campaign.status) ? workspace.campaign : null, (workspace) => ["completed", "cancelled"].includes(workspace.campaign.status)) }, "Campaign resumed");
    return run({ operation: "lifecycle:cancel", scope: campaign.id, payload: { campaignId: campaign.id, action }, mutate: (key) => cancelAdvertisingCampaign(campaign.id, key), reconcile: () => reconcileWorkspace((workspace) => workspace.campaign.status === "cancelled" ? workspace.campaign : null, (workspace) => workspace.campaign.status === "completed") }, "Campaign cancelled");
  }
  return <div className="ads-v2-workspace">
    <nav className="editor-section-nav" aria-label="Campaign steps">{workflow.steps.map((step) => <a key={step.key} href={`#${step.key.replace("_", "-")}`} aria-current={workflow.nextAction.step === step.key ? "step" : undefined}><strong>{step.number}. {step.label}</strong><span>{statusLabel(step.status)}</span></a>)}</nav>
    <section className="business-card" aria-live="polite"><strong>Next: {workflow.nextAction.label}</strong><p>Selections and progress are restored from canonical server state.</p></section>
    <section id="campaign" className="business-card editor-card"><p className="eyebrow">Step 1</p><h2>Campaign</h2><p><strong>{campaign.name}</strong> · {campaign.objective} · <StatusBadge status={campaign.status} /></p></section>
    {campaign.adSets.length > 1 && <FormField label="Ad Set selection"><select value={adSet?.id ?? ""} onChange={(event) => selectEntity("adSet", event.target.value)}><option value="">Select an Ad Set</option>{campaign.adSets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>}
    {campaign.destinations.length > 1 && <FormField label="Destination selection"><select value={destination?.id ?? ""} onChange={(event) => selectEntity("destination", event.target.value)}><option value="">Select a Destination</option>{campaign.destinations.map((item) => <option key={item.id} value={item.id}>{destinationLabel(item.destinationType)} · {item.destinationType === "external_url" ? externalWebsiteSummary(item.externalUrl) : "Saved destination"}</option>)}</select></FormField>}
    {campaignAds.length > 1 && <FormField label="Ad selection"><select value={ad?.id ?? ""} onChange={(event) => selectEntity("ad", event.target.value)}><option value="">Select an Ad</option>{campaignAds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>}
    <section id="ad-set" className="business-card editor-card"><p className="eyebrow">Step 2</p><h2>Ad Set</h2>
      {adSet && !editingAdSet ? <><p><strong>{adSet.name}</strong> · {adSet.startsAt ? `${formatDate(adSet.startsAt)} — ${formatDate(adSet.endsAt ?? "")}` : "No fixed schedule"}</p><button type="button" className="secondary-button" disabled={!owner || pending} onClick={() => setEditingAdSet(true)}>Edit Ad Set</button></> : null}
      {(!adSet || editingAdSet) && (campaign.adSets.length <= 1 || adSet) ? <form className="seller-form" aria-busy={pending} onSubmit={(event) => { event.preventDefault(); if (pending) return; const values = { name: adSetName.trim(), startsAt: startsAt ? new Date(startsAt).toISOString() : null, endsAt: endsAt ? new Date(endsAt).toISOString() : null }; if (adSet) { const payload = { adSetId: adSet.id, ...values, expectedUpdatedAt: adSet.updatedAt }; void run({ operation: "adSet:update", scope: adSet.id, payload, mutate: (key) => updateAdvertisingAdSetDraft(payload, key), reconcile: () => reconcileWorkspace((workspace) => workspace.campaign.adSets.find((item) => item.id === adSet.id && item.name === payload.name && sameInstant(item.startsAt, payload.startsAt) && sameInstant(item.endsAt, payload.endsAt)) ?? null, (workspace) => workspace.campaign.adSets.some((item) => item.id === adSet.id)) }, "Ad Set updated").then((saved) => { if (saved) setEditingAdSet(false); }); } else { const payload = { campaignId: campaign.id, ...values }; void run({ operation: "adSet:create", scope: campaign.id, payload, mutate: (key) => createAdvertisingAdSetDraft(payload, key), reconcile: () => reconcileWorkspace((workspace) => workspace.campaign.adSets.find((item) => item.name === payload.name && sameInstant(item.startsAt, payload.startsAt) && sameInstant(item.endsAt, payload.endsAt)) ?? null, (workspace) => workspace.campaign.adSets.length > 0) }, "Ad Set created"); } }}><FormField label="Ad Set name"><input value={adSetName} onChange={(event) => setAdSetName(event.target.value)} /></FormField><div className="two-column"><FormField label="Start (optional)" hint={`Browser timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></FormField><FormField label="End (optional)"><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></FormField></div><div className="compact-actions"><button className="primary-button" disabled={!owner || pending} type="submit">{pending ? "Saving…" : adSet ? "Save changes" : "Create Ad Set"}</button>{adSet && <button className="secondary-button" type="button" disabled={pending} onClick={() => { setEditingAdSet(false); setAdSetName(adSet.name); setStartsAt(datetimeLocalValue(adSet.startsAt)); setEndsAt(datetimeLocalValue(adSet.endsAt)); }}>Cancel editing</button>}</div></form> : campaign.adSets.length > 1 && !adSet ? <p>Select an Ad Set to continue.</p> : null}
    </section>
    {adSet ? <AudienceTargetingPanel
      audienceIdentity={typeof data.audience?.audience_id === "string" ? data.audience.audience_id : null}
      definition={audienceDefinition}
      exists={Boolean(data.audience)}
      stale={audienceIsStale}
      capabilities={targetingCapabilities}
      capabilitiesUnavailable={targetingCapabilitiesUnavailable}
      owner={owner}
      pending={pending}
      onSave={async (definition) => {
        const audienceId = data.audience?.audience_id as string | undefined;
        return run({
          operation: audienceId ? "audience:version" : "audience:create",
          scope: audienceId ?? adSet.id,
          payload: definition,
          mutate: (key) => audienceId ? createAdvertisingAudienceVersion(audienceId, definition, key) : createAdvertisingAudienceDraft(adSet.id, definition, key),
          reconcile: () => reconcileWorkspace(
            (workspace) => sameAudienceDefinition(audienceDefinitionFromPayload(workspace.audience), definition) ? workspace.audience : null,
            (workspace) => workspace.audience != null,
          ),
        }, audienceId ? "Audience updated" : "Audience created");
      }}
    /> : <section id="audience" className="business-card editor-card"><p className="eyebrow">Step 3</p><h2>Audience</h2><p>Create an Ad Set first.</p></section>}
    {adSet ? <PlacementSelectionPanel savedCodes={persistedPlacements} hasSelection={Boolean(data.placement)} owner={owner} pending={pending} supportAvailable onSave={async (codes) => {
      const payload = { codes: [...codes].sort() };
      const selectionId = data.placement?.placementSelectionId;
      return run({ operation: selectionId ? "placements:version" : "placements:create", scope: selectionId ?? adSet.id, payload, mutate: (key) => selectionId ? createAdvertisingPlacementSelectionVersion(selectionId, payload.codes, key) : createAdvertisingPlacementSelectionDraft(adSet.id, payload.codes, key), reconcile: () => reconcileWorkspace((workspace) => { const current = workspace.placement?.latestVersion?.placements.map((item) => item.code) ?? []; return sameStrings(current, payload.codes) ? workspace.placement : null; }, (workspace) => workspace.placement != null) }, selectionId ? "Placement version updated" : "Placements saved");
    }} /> : <section id="placements" className="business-card editor-card"><p className="eyebrow">Step 4</p><h2>Placements</h2><p>Select or create an Ad Set first.</p></section>}
    {(campaign.destinations.length <= 1 || destination) ? <DestinationPanel destination={destination ?? null} referencedByAd={Boolean(destination && data.creatives.ads.some((item) => item.destinationId === destination.id))} owner={owner} pending={pending} onSave={async (values: DestinationValues) => {
      if (destination) {
        const payload = { destinationId: destination.id, expectedUpdatedAt: destination.updatedAt, ...values };
        return run({ operation: "destination:update", scope: destination.id, payload, mutate: (key) => updateAdvertisingDestinationDraft(payload, key), reconcile: () => reconcileWorkspace((workspace) => workspace.campaign.destinations.find((item) => item.id === destination.id && item.destinationType === payload.type && item.externalUrl === payload.externalUrl && item.targetUserId === payload.targetUserId && item.targetBusinessAccountId === payload.targetBusinessAccountId && item.targetProductId === payload.targetProductId && item.targetStoreId === payload.targetStoreId) ?? null, (workspace) => workspace.campaign.destinations.some((item) => item.id === destination.id)) }, "Destination updated");
      }
      const payload = { campaignId: campaign.id, ...values };
      return run({ operation: "destination:create", scope: campaign.id, payload, mutate: (key) => createAdvertisingDestinationDraft(payload, key), reconcile: () => reconcileWorkspace((workspace) => workspace.campaign.destinations.find((item) => item.destinationType === payload.type && item.externalUrl === payload.externalUrl && item.targetUserId === payload.targetUserId && item.targetBusinessAccountId === payload.targetBusinessAccountId && item.targetProductId === payload.targetProductId && item.targetStoreId === payload.targetStoreId) ?? null, (workspace) => workspace.campaign.destinations.length > 0) }, "Destination created");
    }} /> : <section id="destination" className="business-card editor-card"><p className="eyebrow">Step 5</p><h2>Destination</h2><p>Select a Destination to continue.</p></section>}
    <CreativePanel
      creatives={accountCreatives}
      mediaById={mediaById}
      owner={owner}
      businessOwnerId={businessOwnerId}
      pending={pending}
      onCreate={async (draft) => {
        const payload = { adAccountId: adAccount?.id ?? "", ...draft, primaryText: draft.primaryText ?? undefined, headline: draft.headline ?? undefined, description: draft.description ?? undefined };
        return run({
          operation: "creative:create", scope: payload.adAccountId, payload,
          mutate: (key) => createAdvertisingCreative(payload, key),
          reconcile: ({ idempotencyKey }) => reconcileWorkspace(
            (workspace) => workspace.creatives.creatives.find((item) => item.adAccountId === payload.adAccountId && item.versions.some((version) => version.creationIdempotencyKey === idempotencyKey && sameCreativeContent(version, draft))) ?? null,
            (workspace) => workspace.creatives.creatives.some((item) => item.adAccountId === payload.adAccountId && item.versions.some((version) => version.creationIdempotencyKey === idempotencyKey)),
          ),
        }, "Creative created");
      }}
      onCreateVersion={async (creativeId, draft) => {
        const payload = { creativeId, format: draft.format, mediaAssetId: draft.mediaAssetId, videoAssetId: draft.videoAssetId, primaryText: draft.primaryText ?? undefined, headline: draft.headline ?? undefined, description: draft.description ?? undefined, callToAction: draft.callToAction };
        return run({
          operation: "creative:version", scope: creativeId, payload,
          mutate: (key) => createAdvertisingCreativeVersion(payload, key),
          reconcile: ({ idempotencyKey }) => reconcileWorkspace(
            (workspace) => workspace.creatives.creatives.find((item) => item.id === creativeId)?.versions.find((version) => version.creationIdempotencyKey === idempotencyKey && sameCreativeContent(version, draft)) ?? null,
            (workspace) => Boolean(workspace.creatives.creatives.find((item) => item.id === creativeId)?.versions.some((version) => version.creationIdempotencyKey === idempotencyKey)),
          ),
        }, "Creative updated");
      }}
    />
    <AdAssemblyPanel
      adSetId={adSet?.id ?? null}
      creatives={accountCreatives}
      ads={campaignAds}
      selectedAdId={ad?.id ?? null}
      destinations={campaign.destinations}
      selectedDestinationId={destination?.id ?? null}
      mediaById={mediaById}
      owner={owner}
      pending={pending}
      forceCreate={creatingRevisedAd}
      onSelectAd={(id) => selectEntity("ad", id)}
      onSelectDestination={(id) => selectEntity("destination", id)}
      onCancelCreate={() => setRevisedAdMode(false)}
      onCreate={async (payload) => {
        const created = await run({ operation: "ad:create", scope: payload.adSetId, payload, mutate: (key) => createAdvertisingAdDraft(payload, key), reconcile: ({ idempotencyKey }) => reconcileWorkspace((workspace) => findAdOperationResult(workspace.creatives.ads, idempotencyKey, payload), (workspace) => workspace.creatives.ads.some((item) => item.creationIdempotencyKey === idempotencyKey)) }, creatingRevisedAd ? "Revised ad created" : "Ad assembled", (createdAd) => {
          const createdAdId = typeof createdAd === "object" && createdAd !== null && "id" in createdAd && typeof createdAd.id === "string" ? createdAd.id : null;
          if (createdAdId) setRevisedAdMode(false, createdAdId);
        });
        return created;
      }}
    />
    {!creatingRevisedAd && <BusinessReviewPanel
      ad={ad ?? null}
      creativeName={accountCreatives.find((creative) => creative.versions.some((version) => version.id === ad?.creativeVersionId))?.name ?? null}
      version={allVersions.find((version) => version.id === ad?.creativeVersionId) ?? null}
      media={allVersions.find((version) => version.id === ad?.creativeVersionId) ? mediaById[(allVersions.find((version) => version.id === ad?.creativeVersionId)?.mediaAssetId ?? allVersions.find((version) => version.id === ad?.creativeVersionId)?.videoAssetId) ?? ""] ?? null : null}
      destination={campaign.destinations.find((item) => item.id === ad?.destinationId) ?? null}
      owner={owner}
      pending={pending}
      onSubmit={async () => {
        if (!ad) return false;
        return run({
          operation: "review:submit",
          scope: ad.id,
          payload: { adId: ad.id, creativeVersionId: ad.creativeVersionId, destinationId: ad.destinationId },
          mutate: (key) => submitAdvertisingAdForReview(ad.id, key),
          reconcile: async () => {
            const workspace = await reload();
            const canonical = workspace.creatives.ads.find((item) => item.id === ad.id);
            if (canonical?.reviewStatus !== "not_submitted" && canonical?.submittedAt) return mutationApplied(canonical);
            return canonical ? mutationNotApplied() : mutationDifferent();
          },
        }, "Ad submitted for review");
      }}
      onCreateRevised={() => setRevisedAdMode(true)}
    />}
    <OperationalTruthPanels campaign={campaign} readiness={data.readiness} workflowSteps={workflow.steps} finance={data.finance} analytics={data.analytics} owner={owner} pending={pending} onCreateBudget={createBudgetDraft} onLifecycle={runLifecycleAction} />
  </div>;
}
