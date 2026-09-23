/* eslint-disable react-refresh/only-export-components -- the workspace context and its route pages form one feature boundary */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { FormField, InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import { BusinessMediaPicker, BusinessMediaPreview } from "../../components/BusinessMedia";
import type { BusinessMediaItem } from "../../lib/businessMediaApi";
import {
  ADVERTISING_CTAS,
  ADVERTISING_OBJECTIVES,
  ADVERTISING_PLACEMENTS,
  advertisingUserMessage,
  createAdvertiserBusinessAccount,
  createAdvertisingAdDraft,
  createAdvertisingAdSetDraft,
  createAdvertisingAudienceDraft,
  createAdvertisingCampaignDraft,
  createAdvertisingCreative,
  createAdvertisingDestinationDraft,
  createAdvertisingFinanceDraft,
  createAdvertisingPlacementSelectionDraft,
  getAdvertiserAccounts,
  getMyAgeEligibility,
  getAdvertisingAudience,
  getAdvertisingCampaign,
  getAdvertisingCampaigns,
  getAdvertisingCreativeWorkspace,
  getAdvertisingEventSummary,
  getAdvertisingFinance,
  getAdvertisingPlacementSelection,
  isAdvertisingFinanceNotFound,
  remediateMyAgeEligibility,
  submitAdvertisingAdForReview,
  type AdvertiserAdAccount,
  type AdvertiserBusiness,
  type AdvertisingAudienceDefinition,
  type AdvertisingAgeEligibility,
  type AdvertisingCampaign,
  type AdvertisingCampaignSummary,
  type AdvertisingCreativeWorkspace,
  type AdvertisingFinance,
  type AdvertisingPlacementSelection,
} from "../../lib/adsManagerApi";
import { formatDate, formatMoney } from "../../lib/businessFormat";

type AdvertisingManagerState = {
  accounts: AdvertiserBusiness[];
  campaigns: AdvertisingCampaignSummary[];
  selectedBusiness: AdvertiserBusiness | null;
  selectedAdAccount: AdvertiserAdAccount | null;
  loading: boolean;
  error: string | null;
  ageEligibility: AdvertisingAgeEligibility | null;
  selectBusiness: (id: string) => void;
  selectAdAccount: (id: string) => void;
  createBusiness: (name: string) => Promise<void>;
  remediateAge: (dateOfBirth: string) => Promise<AdvertisingAgeEligibility>;
  refresh: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError(null);
    try {
      const [nextAccounts, nextCampaigns, nextAgeEligibility] = await Promise.all([getAdvertiserAccounts(), getAdvertisingCampaigns(), getMyAgeEligibility()]);
      setAccounts(nextAccounts); setCampaigns(nextCampaigns);
      setAgeEligibility(nextAgeEligibility);
      setSelectedBusinessId((current) => nextAccounts.some((item) => item.businessAccountId === current) ? current : nextAccounts[0]?.businessAccountId ?? "");
    } catch (cause) { setError(advertisingUserMessage(cause)); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);
  const selectedBusiness = accounts.find((item) => item.businessAccountId === selectedBusinessId) ?? accounts[0] ?? null;
  const selectedAdAccount = selectedBusiness?.adAccounts.find((item) => item.id === selectedAdAccountId)
    ?? selectedBusiness?.adAccounts.find((item) => item.isDefault) ?? selectedBusiness?.adAccounts[0] ?? null;
  useEffect(() => { setSelectedAdAccountId(selectedAdAccount?.id ?? ""); }, [selectedBusinessId, selectedAdAccount?.id]);

  const createBusiness = useCallback(async (name: string) => {
    await createAdvertiserBusinessAccount(name);
    await refresh();
  }, [refresh]);

  const remediateAge = useCallback(async (dateOfBirth: string) => {
    const result = await remediateMyAgeEligibility(dateOfBirth);
    setAgeEligibility(result);
    return result;
  }, []);

  const value = useMemo<AdvertisingManagerState>(() => ({ accounts, campaigns, selectedBusiness, selectedAdAccount, loading, error, ageEligibility, selectBusiness: setSelectedBusinessId, selectAdAccount: setSelectedAdAccountId, createBusiness, remediateAge, refresh }), [accounts, campaigns, selectedBusiness, selectedAdAccount, loading, error, ageEligibility, createBusiness, remediateAge, refresh]);
  return <AdvertisingManagerContext.Provider value={value}>{children}</AdvertisingManagerContext.Provider>;
}

function AdvertisingAgeEligibilityPanel() {
  const { ageEligibility, remediateAge } = useAdvertisingManager();
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ageEligibility || ageEligibility.advertiser18PlusEligible) return null;
  if (ageEligibility.evaluated) {
    return <section className="business-card ads-v2-age-gate" role="status">
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

  return <section className="business-card ads-v2-age-gate">
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
  const [name, setName] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(null); try { await createBusiness(name); } catch (cause) { setError(advertisingUserMessage(cause)); } finally { setSaving(false); } }
  return <section className="business-card ads-v2-onboarding"><p className="eyebrow">Advertiser identity</p><h2>Create your business account</h2><p>You can advertise without becoming a Marketplace seller or creating a Store or Product.</p><InlineError message={error} /><form className="seller-form" onSubmit={(event) => void submit(event)}><FormField label="Business name"><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></FormField><button className="primary-button" disabled={saving} type="submit">{saving ? "Creating…" : "Create business account"}</button></form></section>;
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
  const [name, setName] = useState(""); const [objective, setObjective] = useState<(typeof ADVERTISING_OBJECTIVES)[number]>("awareness"); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  const owner = selectedBusiness?.accessType === "owner";
  const canWrite = owner && ageEligibility?.advertiser18PlusEligible === true;
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!canWrite || !selectedAdAccount) return; setSaving(true); setError(null); try { const campaign = await createAdvertisingCampaignDraft({ adAccountId: selectedAdAccount.id, name, objective }); navigate(`/ads/campaigns/${campaign.id}`); } catch (cause) { setError(advertisingUserMessage(cause)); } finally { setSaving(false); } }
  if (accounts.length === 0) return <><PageHeader eyebrow="Ads Manager" title="Create campaign draft" description="Create a Business Account first." /><AdvertiserOnboarding /></>;
  return <><PageHeader eyebrow="Ads Manager · Step 1" title="Create campaign draft" description="This creates a general Ads V2 draft. It does not fund, activate, or deliver advertising." action={<Link className="text-button" to="/ads">Back</Link>} /><AccountSelectors /><InlineError message={error} />{owner && <AdvertisingAgeEligibilityPanel />}{!owner && <div className="readonly-note">Only the Business Account owner can create Ads V2 drafts.</div>}<form className="business-card ads-v2-compact-form" onSubmit={(event) => void submit(event)}><FormField label="Campaign name"><input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></FormField><FormField label="Objective"><select value={objective} onChange={(event) => setObjective(event.target.value as (typeof ADVERTISING_OBJECTIVES)[number])}>{ADVERTISING_OBJECTIVES.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></FormField><FormField label="Ad Account"><input readOnly value={selectedAdAccount?.name ?? ""} /></FormField><button className="primary-button" type="submit" disabled={!canWrite || !selectedAdAccount || saving}>{saving ? "Creating…" : "Create draft"}</button></form></>;
}

type WorkspaceData = { campaign: AdvertisingCampaign; creatives: AdvertisingCreativeWorkspace; finance: AdvertisingFinance | null; analytics: Record<string, unknown>; audience: Record<string, unknown> | null; placement: AdvertisingPlacementSelection | null };

const defaultAudience: AdvertisingAudienceDefinition = { age_scope: "adults_only", geographies: [], languages: [], dayparts: [], frequency: null };

export function BusinessAdsManagerCampaignPage() {
  const { campaignId = "" } = useParams();
  const { accounts, refresh: refreshList, ageEligibility } = useAdvertisingManager();
  const [data, setData] = useState<WorkspaceData | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [success, setSuccess] = useState<string | null>(null);
  const campaignBusiness = data ? accounts.find((item) => item.businessAccountId === data.campaign.businessAccountId) ?? null : null;
  const campaignAdAccount = data ? campaignBusiness?.adAccounts.find((item) => item.id === data.campaign.adAccountId) ?? null : null;
  const owner = campaignBusiness?.accessType === "owner";
  const canWrite = owner && ageEligibility?.advertiser18PlusEligible === true;
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const campaign = await getAdvertisingCampaign(campaignId, "ads_v2");
      const adSet = campaign.adSets[0];
      const [creatives, finance, analytics, audience, placement] = await Promise.all([
        getAdvertisingCreativeWorkspace(),
        getAdvertisingFinance(campaignId).catch((cause) => {
          if (isAdvertisingFinanceNotFound(cause)) return null;
          throw cause;
        }),
        getAdvertisingEventSummary(campaignId),
        adSet?.audience ? getAdvertisingAudience(adSet.audience.id) : Promise.resolve(null),
        adSet?.placementSelection ? getAdvertisingPlacementSelection(adSet.placementSelection.id) : Promise.resolve(null),
      ]);
      setData({ campaign, creatives, finance, analytics, audience, placement });
    } catch (cause) { setError(advertisingUserMessage(cause)); }
    finally { setLoading(false); }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load]);
  async function run(action: () => Promise<unknown>, message: string) { setError(null); setSuccess(null); try { await action(); setSuccess(message); await Promise.all([load(), refreshList()]); } catch (cause) { setError(advertisingUserMessage(cause)); } }
  if (loading) return <div className="seller-state">Restoring campaign workspace from server…</div>;
  if (!data) return <><InlineError message={error} /><Link to="/ads">Back to campaigns</Link></>;
  return <><PageHeader eyebrow="Ads V2 draft workspace" title={data.campaign.name} description="Server-backed configuration. Refreshing this page reconstructs Audience, Placements, Creative, Review, Finance and Analytics." action={<Link className="text-button" to="/ads">Back to campaigns</Link>} /><InlineError message={error} />{success && <div className="inline-success" role="status">{success}</div>}{owner && <AdvertisingAgeEligibilityPanel />}{!owner && <div className="readonly-note">This campaign is not writable by the current owner-authoritative Ads V2 RPCs.</div>}<AccountSelectors business={campaignBusiness} adAccount={campaignAdAccount} locked /><CampaignWorkspace data={data} business={campaignBusiness} adAccount={campaignAdAccount} owner={canWrite} run={run} /></>;
}

function CampaignWorkspace({ data, business, adAccount, owner, run }: { data: WorkspaceData; business: AdvertiserBusiness | null; adAccount: AdvertiserAdAccount | null; owner: boolean; run: (action: () => Promise<unknown>, message: string) => Promise<void> }) {
  const { user } = useBusinessAuth();
  const campaign = data.campaign; const adSet = campaign.adSets[0]; const destination = campaign.destinations[0]; const campaignAds = data.creatives.ads.filter((ad) => ad.campaignId === campaign.id); const ad = campaignAds[0];
  const accountCreatives = data.creatives.creatives.filter((creative) => creative.adAccountId === campaign.adAccountId && creative.status === "draft");
  const versions = accountCreatives.flatMap((creative) => creative.versions.map((version) => ({ ...version, creativeName: creative.name })));
  const [adSetName, setAdSetName] = useState("Primary Ad Set"); const [startsAt, setStartsAt] = useState(""); const [endsAt, setEndsAt] = useState("");
  const [geoMode, setGeoMode] = useState<"include" | "exclude">("include"); const [geoType, setGeoType] = useState<"country" | "region" | "city" | "radius">("country"); const [country, setCountry] = useState(""); const [region, setRegion] = useState(""); const [city, setCity] = useState(""); const [latitude, setLatitude] = useState(""); const [longitude, setLongitude] = useState(""); const [radius, setRadius] = useState(""); const [language, setLanguage] = useState(""); const [timezone, setTimezone] = useState("America/Caracas"); const [weekday, setWeekday] = useState("1"); const [dayStart, setDayStart] = useState(""); const [dayEnd, setDayEnd] = useState(""); const [frequency, setFrequency] = useState(""); const [frequencyWindow, setFrequencyWindow] = useState("24");
  const [placements, setPlacements] = useState<string[]>(["social_feed"]);
  const [destinationType, setDestinationType] = useState("external_url"); const [destinationValue, setDestinationValue] = useState("");
  const [creativeName, setCreativeName] = useState("Primary Creative"); const [creativeFormat, setCreativeFormat] = useState<"image" | "video">("image"); const [mediaId, setMediaId] = useState(""); const [primaryText, setPrimaryText] = useState(""); const [headline, setHeadline] = useState(""); const [description, setDescription] = useState(""); const [cta, setCta] = useState("learn_more");
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false); const [selectedMedia, setSelectedMedia] = useState<BusinessMediaItem | null>(null);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? ""); const [adName, setAdName] = useState("Primary Ad"); const [budget, setBudget] = useState("");
  useEffect(() => { if (!versionId && versions[0]) setVersionId(versions[0].id); }, [versionId, versions]);
  const persistedPlacements = data.placement?.latestVersion?.placements.map((item) => item.code) ?? null;
  const displayedPlacements = persistedPlacements ?? placements;
  const definition: AdvertisingAudienceDefinition = { ...defaultAudience, geographies: country ? [{ mode: geoMode, type: geoType, country_code: country.toUpperCase(), ...(geoType === "region" ? { region_code: region } : {}), ...(geoType === "city" ? { region_code: region || undefined, city_name: city } : {}), ...(geoType === "radius" ? { latitude: Number(latitude), longitude: Number(longitude), radius_km: Number(radius) } : {}) }] : [], languages: language ? [{ mode: "include", tag: language }] : [], dayparts: dayStart && dayEnd ? [{ timezone, weekday: Number(weekday), start: dayStart, end: dayEnd }] : [], frequency: frequency ? { max_impressions: Number(frequency), window_hours: Number(frequencyWindow) } : null };
  const readiness = [
    ["Campaign draft", true], ["Ad Set configured", Boolean(adSet)], ["Audience configured", Boolean(adSet?.audience)], ["Placements configured", Boolean(adSet?.placementSelection)], ["Destination configured", Boolean(destination)], ["Creative configured", versions.length > 0], ["Ad assembled", Boolean(ad)], ["Review status", ad?.reviewStatus ?? "not_submitted"], ["Budget draft", Boolean(data.finance)],
  ];
  return <div className="ads-v2-workspace">
    <nav className="editor-section-nav" aria-label="Campaign steps">{["ad-set", "audience", "placements", "destination", "creative", "ad", "review", "budget", "readiness"].map((item, index) => <a key={item} href={`#${item}`}>{index + 2}. {item.replace("-", " ")}</a>)}</nav>
    <section id="ad-set" className="business-card editor-card"><p className="eyebrow">Step 2</p><h2>Ad Set</h2>{adSet ? <p><strong>{adSet.name}</strong> · {adSet.startsAt ? `${formatDate(adSet.startsAt)} — ${formatDate(adSet.endsAt ?? "")}` : "No fixed schedule"}</p> : <form className="seller-form" onSubmit={(event) => { event.preventDefault(); void run(() => createAdvertisingAdSetDraft({ campaignId: campaign.id, name: adSetName, startsAt: startsAt ? new Date(startsAt).toISOString() : null, endsAt: endsAt ? new Date(endsAt).toISOString() : null }), "Ad Set created"); }}><FormField label="Ad Set name"><input value={adSetName} onChange={(event) => setAdSetName(event.target.value)} /></FormField><div className="two-column"><FormField label="Start (optional)"><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></FormField><FormField label="End (optional)"><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></FormField></div><button className="primary-button" disabled={!owner} type="submit">Create Ad Set</button></form>}</section>
    <section id="audience" className="business-card editor-card"><p className="eyebrow">Step 3</p><h2>Audience</h2><div className="readonly-note">Age is fixed to Adults 18+. Geographic and language delivery matching are not active yet.</div>{data.audience ? <pre className="ads-v2-definition">{JSON.stringify(data.audience, null, 2)}</pre> : adSet ? <form className="seller-form" onSubmit={(event) => { event.preventDefault(); void run(() => createAdvertisingAudienceDraft(adSet.id, definition), "Audience created"); }}><FormField label="Age"><input value="Adults 18+" readOnly /></FormField><div className="form-grid"><FormField label="Geo mode"><select value={geoMode} onChange={(event) => setGeoMode(event.target.value as "include" | "exclude")}><option value="include">Include</option><option value="exclude">Exclude</option></select></FormField><FormField label="Geo type"><select value={geoType} onChange={(event) => setGeoType(event.target.value as typeof geoType)}><option value="country">Country</option><option value="region">Region</option><option value="city">City</option><option value="radius">Radius</option></select></FormField><FormField label="Country code"><input maxLength={2} value={country} onChange={(event) => setCountry(event.target.value)} placeholder="VE" /></FormField>{geoType === "region" && <FormField label="Region code"><input value={region} onChange={(event) => setRegion(event.target.value)} /></FormField>}{geoType === "city" && <><FormField label="Region code (optional)"><input value={region} onChange={(event) => setRegion(event.target.value)} /></FormField><FormField label="City"><input value={city} onChange={(event) => setCity(event.target.value)} /></FormField></>}{geoType === "radius" && <><FormField label="Latitude"><input type="number" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></FormField><FormField label="Longitude"><input type="number" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></FormField><FormField label="Radius km"><input type="number" min="1" max="100" value={radius} onChange={(event) => setRadius(event.target.value)} /></FormField></>}<FormField label="Language tag"><input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="es" /></FormField><FormField label="Timezone"><input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></FormField><FormField label="Weekday (1 Monday – 7 Sunday)"><input type="number" min="1" max="7" value={weekday} onChange={(event) => setWeekday(event.target.value)} /></FormField><FormField label="Daypart start"><input type="time" value={dayStart} onChange={(event) => setDayStart(event.target.value)} /></FormField><FormField label="Daypart end"><input type="time" value={dayEnd} onChange={(event) => setDayEnd(event.target.value)} /></FormField><FormField label="Max impressions"><input type="number" min="1" max="20" value={frequency} onChange={(event) => setFrequency(event.target.value)} /></FormField><FormField label="Frequency window hours"><input type="number" min="1" max="168" value={frequencyWindow} onChange={(event) => setFrequencyWindow(event.target.value)} /></FormField></div><button className="primary-button" disabled={!owner} type="submit">Save Audience</button></form> : <p>Create an Ad Set first.</p>}</section>
    <section id="placements" className="business-card editor-card"><p className="eyebrow">Step 4</p><h2>Placements</h2><p className="muted-copy">Every surface is configurable for a future adapter. Delivery not active.</p>{data.placement ? <pre className="ads-v2-definition">{JSON.stringify(data.placement, null, 2)}</pre> : adSet ? <form onSubmit={(event) => { event.preventDefault(); void run(() => createAdvertisingPlacementSelectionDraft(adSet.id, placements), "Placements saved"); }}><div className="ads-placement-grid">{ADVERTISING_PLACEMENTS.map((code) => <label key={code} className={placements.includes(code) ? "ads-placement-option is-selected" : "ads-placement-option"}><input type="checkbox" checked={placements.includes(code)} onChange={() => setPlacements((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code])} /><span><strong>{code}</strong><small>Delivery not active</small></span></label>)}</div><button className="primary-button" disabled={!owner || placements.length === 0} type="submit">Save Placements</button></form> : <p>Create an Ad Set first.</p>}</section>
    <section id="destination" className="business-card editor-card"><p className="eyebrow">Step 5</p><h2>Destination</h2>{destination ? <p><strong>{destination.destinationType}</strong> · {destination.externalUrl ?? destination.targetProductId ?? destination.targetStoreId ?? destination.targetBusinessAccountId ?? destination.targetUserId}</p> : <form className="seller-form" onSubmit={(event) => { event.preventDefault(); const value = destinationValue.trim(); void run(() => createAdvertisingDestinationDraft({ campaignId: campaign.id, type: destinationType, externalUrl: destinationType === "external_url" ? value : null, targetUserId: destinationType === "nelyon_profile" ? (value || user?.id) : null, targetBusinessAccountId: destinationType === "business_account" ? (value || business?.businessAccountId) : null, targetProductId: destinationType === "marketplace_product" ? value : null, targetStoreId: destinationType === "marketplace_store" ? value : null }), "Destination created"); }}><FormField label="Destination type"><select value={destinationType} onChange={(event) => setDestinationType(event.target.value)}>{["external_url", "nelyon_profile", "business_account", "marketplace_product", "marketplace_store"].map((item) => <option key={item}>{item}</option>)}</select></FormField><FormField label={destinationType === "external_url" ? "HTTPS URL" : "Canonical target ID"} hint={destinationType === "business_account" || destinationType === "nelyon_profile" ? "Leave blank to use this Campaign Business or your own profile." : undefined}><input required={destinationType !== "business_account" && destinationType !== "nelyon_profile"} value={destinationValue} onChange={(event) => setDestinationValue(event.target.value)} /></FormField><button className="primary-button" disabled={!owner} type="submit">Create Destination</button></form>}</section>
    <section id="creative" className="business-card editor-card"><p className="eyebrow">Step 6</p><h2>Creative</h2>{versions.length > 0 && <FormField label="Existing Creative Version"><select value={versionId} onChange={(event) => setVersionId(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.id}>{item.creativeName} · v{item.versionNumber} · {item.format}</option>)}</select></FormField>}<details><summary>Create from canonical Business Media</summary><form className="seller-form" onSubmit={(event) => { event.preventDefault(); void run(() => createAdvertisingCreative({ adAccountId: adAccount?.id ?? "", name: creativeName, format: creativeFormat, mediaAssetId: creativeFormat === "image" ? mediaId : null, videoAssetId: creativeFormat === "video" ? mediaId : null, primaryText, headline, description, callToAction: cta }), "Creative created"); }}><div className="readonly-note">Reuses the existing Business Media picker and canonical R2/Stream assets. No uploader or storage authority is created here.</div><FormField label="Creative name"><input value={creativeName} onChange={(event) => setCreativeName(event.target.value)} /></FormField><FormField label="Format"><select value={creativeFormat} onChange={(event) => { setCreativeFormat(event.target.value as "image" | "video"); setMediaId(""); setSelectedMedia(null); }}><option value="image">Image</option><option value="video">Video</option></select></FormField><div className="store-media-section"><button className="secondary-button" type="button" onClick={() => setMediaPickerOpen(true)}>Choose from Media Library</button>{selectedMedia && <div className="store-media-preview"><BusinessMediaPreview item={selectedMedia} /></div>}</div><FormField label="Canonical media asset ID"><input readOnly required value={mediaId} /></FormField><FormField label="Primary text"><textarea maxLength={2200} value={primaryText} onChange={(event) => setPrimaryText(event.target.value)} /></FormField><FormField label="Headline"><input maxLength={255} value={headline} onChange={(event) => setHeadline(event.target.value)} /></FormField><FormField label="Description"><textarea maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></FormField><FormField label="Call to action"><select value={cta} onChange={(event) => setCta(event.target.value)}>{ADVERTISING_CTAS.map((item) => <option key={item}>{item}</option>)}</select></FormField><button className="primary-button" disabled={!owner || !adAccount || !mediaId} type="submit">Create Creative</button></form></details><BusinessMediaPicker open={mediaPickerOpen} selectedId={mediaId || null} title={`Select ${creativeFormat} creative`} kind={creativeFormat} businessOwnerId={business?.marketplace.marketplaceSellerUserId ?? user?.id} allowUpload={owner} onSelect={(item) => { setSelectedMedia(item); setMediaId(item.assetId); setMediaPickerOpen(false); }} onClose={() => setMediaPickerOpen(false)} /></section>
    <section id="ad" className="business-card editor-card"><p className="eyebrow">Step 7</p><h2>Ad assembly</h2>{ad ? <p><strong>{ad.name}</strong> · <StatusBadge status={ad.reviewStatus} /></p> : <form className="seller-form" onSubmit={(event) => { event.preventDefault(); if (!adSet || !destination) return; void run(() => createAdvertisingAdDraft({ adSetId: adSet.id, creativeVersionId: versionId, destinationId: destination.id, name: adName }), "Ad assembled"); }}><FormField label="Ad name"><input value={adName} onChange={(event) => setAdName(event.target.value)} /></FormField><FormField label="Creative Version"><select required value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value="">Select</option>{versions.map((item) => <option key={item.id} value={item.id}>{item.creativeName} · v{item.versionNumber}</option>)}</select></FormField><button className="primary-button" disabled={!owner || !adSet || !destination || !versionId} type="submit">Assemble Ad</button></form>}</section>
    <section id="review" className="business-card editor-card"><p className="eyebrow">Step 8</p><h2>Review</h2>{ad ? <><div className="ads-v2-preview"><strong>{versions.find((item) => item.id === ad.creativeVersionId)?.headline ?? ad.name}</strong><p>{versions.find((item) => item.id === ad.creativeVersionId)?.primaryText}</p><span>Destination: {destination?.destinationType}</span><span>Audience: Adults 18+</span><span>Placements: {displayedPlacements.join(", ")}</span></div><p>Review status: <StatusBadge status={ad.reviewStatus} /></p>{ad.latestRejectionMessage && <div className="readonly-note">{ad.latestRejectionMessage}</div>}{(ad.reviewStatus === "not_submitted" || ad.reviewStatus === "rejected") && <button className="primary-button" disabled={!owner} type="button" onClick={() => void run(() => submitAdvertisingAdForReview(ad.id), "Ad submitted for review")}>Submit for review</button>}</> : <p>Assemble an Ad first.</p>}</section>
    <section id="budget" className="business-card editor-card"><p className="eyebrow">Step 9</p><h2>Budget draft</h2>{data.finance ? <div className="ads-summary-grid"><Metric label="Budget" value={formatMoney(data.finance.budgetBdag)} /><Metric label="Funded" value={formatMoney(data.finance.fundedBdag)} /><Metric label="Spent" value={formatMoney(data.finance.spentBdag)} /><Metric label="Released" value={formatMoney(data.finance.releasedBdag)} /><Metric label="Reserved" value={formatMoney(data.finance.reservedBdag)} /></div> : <form className="seller-form" onSubmit={(event) => { event.preventDefault(); void run(() => createAdvertisingFinanceDraft(campaign.id, Number(budget)), "Budget draft created"); }}><FormField label="Budget BDAG"><input type="number" min="0.00000001" step="0.00000001" required value={budget} onChange={(event) => setBudget(event.target.value)} /></FormField><button className="primary-button" disabled={!owner} type="submit">Define budget draft</button></form>}<div className="readonly-note"><strong>Funding is not enabled yet.</strong> No Fund, Pay, Launch or Activate action is available.</div></section>
    <section id="readiness" className="business-card editor-card"><p className="eyebrow">Step 10</p><h2>Readiness summary</h2><ul className="ads-v2-checklist">{readiness.map(([label, value]) => <li key={String(label)} className={value === true || (typeof value === "string" && value !== "not_submitted") ? "is-ready" : ""}><span aria-hidden="true">{value === true || (typeof value === "string" && value !== "not_submitted") ? "✓" : "○"}</span><strong>{label}</strong>{typeof value === "string" && <small>{value}</small>}</li>)}</ul><div className="ads-v2-locked"><strong>Not available yet</strong><span>Campaign activation</span><span>Funding</span><span>Live delivery</span></div><h3>Aggregate analytics</h3><div className="ads-summary-grid"><Metric label="Impressions" value={String(data.analytics.impressions ?? 0)} /><Metric label="Clicks" value={String(data.analytics.clicks ?? 0)} /><Metric label="Conversions" value={String(data.analytics.conversions ?? 0)} /><Metric label="CTR" value={String(data.analytics.ctr ?? 0)} /></div></section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <article className="ads-metric-card"><span>{label}</span><strong>{value}</strong></article>; }
