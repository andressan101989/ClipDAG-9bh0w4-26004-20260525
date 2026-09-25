/* eslint-disable react-refresh/only-export-components -- preview helpers are shared by the Ads feature components */
import { useEffect, useMemo, useRef, useState } from "react";
import { BusinessMediaPicker, BusinessMediaPreview } from "../BusinessMedia";
import { FormField, StatusBadge } from "../BusinessUI";
import {
  ADS_CTA_OPTIONS,
  creativeFormErrors,
  ctaLabel,
  latestCreativeOptions,
  latestCreativeVersion,
  normalizeCreativeDraft,
  sameCreativeContent,
  type CreativeDraftInput,
  type NormalizedCreativeDraft,
} from "../../lib/adsCreativeUx";
import { externalWebsiteSummary, isCurrentReleaseDestination } from "../../lib/adsPlacementDestinationUx";
import type { AdvertisingAd, AdvertisingCreative, AdvertisingCreativeVersion, AdvertisingDestination } from "../../lib/adsManagerApi";
import type { BusinessMediaItem } from "../../lib/businessMediaApi";

type MediaById = Record<string, BusinessMediaItem>;

export function versionMedia(version: AdvertisingCreativeVersion | null, mediaById: MediaById) {
  const id = version?.mediaAssetId ?? version?.videoAssetId;
  return id ? mediaById[id] ?? null : null;
}

export function CreativePreview({ version, media, name }: { version: Pick<AdvertisingCreativeVersion, "primaryText" | "headline" | "description" | "callToAction">; media: BusinessMediaItem | null; name: string }) {
  return <article className="ads-creative-preview" aria-label={`${name} preview`}>
    <span className="ads-preview-label">Preview</span>
    <div className="ads-creative-preview-media">{media ? <BusinessMediaPreview item={media} locale="en" /> : <div className="media-placeholder">Choose media to preview</div>}</div>
    {version.primaryText && <p>{version.primaryText}</p>}
    {version.headline && <h3>{version.headline}</h3>}
    {version.description && <p className="muted-copy">{version.description}</p>}
    {version.callToAction !== "none" && <span className="secondary-button ads-preview-cta" aria-disabled="true">{ctaLabel(version.callToAction)}</span>}
  </article>;
}

function draftFromVersion(name: string, version: AdvertisingCreativeVersion, media: BusinessMediaItem | null): CreativeDraftInput {
  return {
    name,
    media,
    primaryText: version.primaryText ?? "",
    headline: version.headline ?? "",
    description: version.description ?? "",
    callToAction: version.callToAction,
  };
}

const emptyDraft = (): CreativeDraftInput => ({ name: "Primary Creative", media: null, primaryText: "", headline: "", description: "", callToAction: "learn_more" });

export function CreativePanel({ creatives, mediaById, owner, businessOwnerId, pending, onCreate, onCreateVersion }: {
  creatives: AdvertisingCreative[];
  mediaById: MediaById;
  owner: boolean;
  businessOwnerId?: string;
  pending: boolean;
  onCreate: (draft: NormalizedCreativeDraft) => Promise<boolean>;
  onCreateVersion: (creativeId: string, draft: NormalizedCreativeDraft) => Promise<boolean>;
}) {
  const [selectedCreativeId, setSelectedCreativeId] = useState(() => creatives.length === 1 ? creatives.at(0)?.id ?? null : null);
  const selectedCreative = creatives.find((creative) => creative.id === selectedCreativeId) ?? null;
  const latest = selectedCreative ? latestCreativeVersion(selectedCreative.versions) : null;
  const [mode, setMode] = useState<"create" | "edit" | null>(() => creatives.length === 0 ? "create" : null);
  const [draft, setDraft] = useState<CreativeDraftInput>(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localPending, setLocalPending] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (creatives.length === 1 && !selectedCreativeId) setSelectedCreativeId(creatives.at(0)?.id ?? null);
    if (selectedCreativeId && !creatives.some((creative) => creative.id === selectedCreativeId)) setSelectedCreativeId(null);
  }, [creatives, selectedCreativeId]);

  const latestMedia = latest ? versionMedia(latest, mediaById) : null;
  useEffect(() => {
    if (mode !== "edit" || !latestMedia) return;
    setDraft((current) => current.media ? current : { ...current, media: latestMedia });
  }, [latestMedia, mode]);

  const normalized = normalizeCreativeDraft(draft);
  const errors = creativeFormErrors(draft);
  const unchanged = mode === "edit" && latest ? sameCreativeContent(latest, normalized) : false;
  const busy = pending || localPending;

  const beginCreate = () => {
    setDraft(emptyDraft());
    setAttempted(false);
    setSavedMessage(null);
    setMode("create");
  };
  const beginEdit = () => {
    if (!selectedCreative || !latest) return;
    setDraft(draftFromVersion(selectedCreative.name, latest, versionMedia(latest, mediaById)));
    setAttempted(false);
    setSavedMessage(null);
    setMode("edit");
  };

  const save = async () => {
    if (!owner || inFlight.current || busy) return;
    setAttempted(true);
    if (Object.keys(errors).length > 0 || unchanged) return;
    inFlight.current = true;
    setLocalPending(true);
    setSavedMessage(null);
    try {
      const saved = mode === "edit" && selectedCreative
        ? await onCreateVersion(selectedCreative.id, normalized)
        : await onCreate(normalized);
      if (saved) {
        setSavedMessage(mode === "edit" ? "Creative updated." : "Creative created.");
        setMode(null);
      }
    } finally {
      inFlight.current = false;
      setLocalPending(false);
    }
  };

  const previewVersion = { primaryText: normalized.primaryText, headline: normalized.headline, description: normalized.description, callToAction: normalized.callToAction };
  return <section id="creative" className="business-card editor-card">
    <p className="eyebrow">Step 6</p>
    <div className="section-heading"><div><h2>Creative</h2><p>Choose media, write your message, and preview the ad.</p></div>{owner && mode === null && <button className="secondary-button" type="button" onClick={beginCreate}>Create another creative</button>}</div>
    {creatives.length > 1 && <fieldset className="ads-choice-fieldset"><legend>Choose a creative</legend><div className="ads-choice-grid">{creatives.map((creative) => {
      const version = latestCreativeVersion(creative.versions);
      return <label className={creative.id === selectedCreativeId ? "ads-choice-card is-selected" : "ads-choice-card"} key={creative.id}><input type="radio" name="creative-summary" checked={creative.id === selectedCreativeId} disabled={mode !== null || busy} onChange={() => { if (mode === null && !busy) setSelectedCreativeId(creative.id); }} /><span><strong>{creative.name}</strong><small>{version?.headline ?? version?.primaryText ?? "Creative ready"}</small></span></label>;
    })}</div></fieldset>}
    {selectedCreative && latest && mode === null && <div className="ads-creative-summary">
      <CreativePreview name={selectedCreative.name} version={latest} media={versionMedia(latest, mediaById)} />
      <div><h3>{selectedCreative.name}</h3><p>{ctaLabel(latest.callToAction)}</p><button className="secondary-button" type="button" disabled={!owner || busy} onClick={beginEdit}>Edit creative</button><p className="readonly-note">Existing ads keep the creative version they were created with.</p></div>
    </div>}
    {mode && <form className="seller-form ads-creative-composer" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="Creative name" hint="Only you see this name."><input required minLength={2} maxLength={120} disabled={busy} readOnly={mode === "edit"} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} aria-invalid={attempted && Boolean(errors.name)} />{attempted && errors.name && <small className="field-error">{errors.name}</small>}</FormField>
      <fieldset className="ads-media-fieldset"><legend>Media</legend><button className="secondary-button" type="button" disabled={!owner || busy} onClick={() => setPickerOpen(true)}>Choose from Media Library</button>{draft.media ? <div className="ads-selected-media"><BusinessMediaPreview item={draft.media} locale="en" /><span>{draft.media.mediaKind === "image" ? "Image selected" : "Video selected"}</span></div> : <div className="ads-media-empty"><strong>No media selected</strong><span>Upload media or choose a ready item from your Business Library.</span></div>}{attempted && errors.media && <small className="field-error">{errors.media}</small>}</fieldset>
      <FormField label="Primary text" hint={`${draft.primaryText.length}/2200`}><textarea maxLength={2200} disabled={busy} value={draft.primaryText} onChange={(event) => setDraft((current) => ({ ...current, primaryText: event.target.value }))} aria-invalid={attempted && Boolean(errors.primaryText)} />{attempted && errors.primaryText && <small className="field-error">{errors.primaryText}</small>}</FormField>
      <FormField label="Headline" hint={`${draft.headline.length}/255`}><input maxLength={255} disabled={busy} value={draft.headline} onChange={(event) => setDraft((current) => ({ ...current, headline: event.target.value }))} aria-invalid={attempted && Boolean(errors.headline)} />{attempted && errors.headline && <small className="field-error">{errors.headline}</small>}</FormField>
      <FormField label="Description" hint={`${draft.description.length}/500`}><textarea maxLength={500} disabled={busy} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} aria-invalid={attempted && Boolean(errors.description)} />{attempted && errors.description && <small className="field-error">{errors.description}</small>}</FormField>
      <FormField label="Call to action"><select disabled={busy} value={draft.callToAction} onChange={(event) => setDraft((current) => ({ ...current, callToAction: event.target.value }))}>{ADS_CTA_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></FormField>
      <CreativePreview name={draft.name || "Creative"} version={previewVersion} media={draft.media} />
      {unchanged && <p className="readonly-note">No changes to save.</p>}
      <div className="compact-actions"><button className="primary-button" type="submit" disabled={!owner || busy || unchanged}>{busy ? "Saving…" : mode === "edit" ? "Save changes" : "Save creative"}</button>{(mode === "edit" || creatives.length > 0) && <button className="secondary-button" type="button" disabled={busy} onClick={() => setMode(null)}>Cancel</button>}</div>
    </form>}
    {savedMessage && <p className="inline-success" role="status">{savedMessage}</p>}
    <BusinessMediaPicker open={pickerOpen} selectedId={draft.media?.assetId ?? null} title="Choose creative media" kind={null} requiredPurpose="business_library" showUnavailable businessOwnerId={businessOwnerId} allowUpload={owner} locale="en" onSelect={(item) => { setDraft((current) => ({ ...current, media: item })); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />
  </section>;
}

export function destinationSummary(destination: AdvertisingDestination) {
  return destination.destinationType === "external_url" ? externalWebsiteSummary(destination.externalUrl) : "Saved destination";
}

export function AdAssemblyPanel({ adSetId, creatives, ads, selectedAdId, destinations, selectedDestinationId, mediaById, owner, pending, forceCreate = false, onSelectAd, onSelectDestination, onCreate, onCancelCreate }: {
  adSetId: string | null;
  creatives: AdvertisingCreative[];
  ads: AdvertisingAd[];
  selectedAdId: string | null;
  destinations: AdvertisingDestination[];
  selectedDestinationId: string | null;
  mediaById: MediaById;
  owner: boolean;
  pending: boolean;
  forceCreate?: boolean;
  onSelectAd: (id: string) => void;
  onSelectDestination: (id: string) => void;
  onCreate: (payload: { adSetId: string; creativeVersionId: string; destinationId: string; name: string }) => Promise<boolean>;
  onCancelCreate?: () => void;
}) {
  const options = useMemo(() => latestCreativeOptions(creatives, mediaById), [creatives, mediaById]);
  const [creativeVersionId, setCreativeVersionId] = useState(() => options.length === 1 ? options.at(0)?.version.id ?? "" : "");
  const [adName, setAdName] = useState("Primary Ad");
  const [localPending, setLocalPending] = useState(false);
  const inFlight = useRef(false);
  const selectedAd = ads.find((ad) => ad.id === selectedAdId) ?? null;
  const selectedOption = options.find((item) => item.version.id === creativeVersionId) ?? null;
  const selectedDestination = destinations.find((item) => item.id === selectedDestinationId && isCurrentReleaseDestination(item)) ?? null;

  useEffect(() => {
    if (options.length === 1 && !creativeVersionId) setCreativeVersionId(options.at(0)?.version.id ?? "");
    if (creativeVersionId && !options.some((item) => item.version.id === creativeVersionId)) setCreativeVersionId("");
  }, [creativeVersionId, options]);

  if (!forceCreate && ads.length > 1 && !selectedAd) return <section id="ad" className="business-card editor-card"><p className="eyebrow">Step 7</p><h2>Ad assembly</h2><fieldset className="ads-choice-fieldset"><legend>Choose an ad</legend><div className="ads-choice-grid">{ads.map((ad) => <label className="ads-choice-card" key={ad.id}><input type="radio" name="ad-selection" checked={false} onChange={() => onSelectAd(ad.id)} /><span><strong>{ad.name}</strong><small>{ad.reviewStatus.replaceAll("_", " ")}</small></span></label>)}</div></fieldset></section>;

  if (!forceCreate && selectedAd) {
    const pinnedCreative = creatives.find((creative) => creative.versions.some((version) => version.id === selectedAd.creativeVersionId));
    const pinnedVersion = pinnedCreative?.versions.find((version) => version.id === selectedAd.creativeVersionId) ?? null;
    const pinnedDestination = destinations.find((item) => item.id === selectedAd.destinationId) ?? null;
    return <section id="ad" className="business-card editor-card"><p className="eyebrow">Step 7</p><h2>Ad assembly</h2><div className="ads-creative-summary">{pinnedVersion && <CreativePreview name={pinnedCreative?.name ?? selectedAd.name} version={pinnedVersion} media={versionMedia(pinnedVersion, mediaById)} />}<div><h3>{selectedAd.name}</h3><p>{pinnedDestination ? destinationSummary(pinnedDestination) : "Destination unavailable"}</p><StatusBadge status={selectedAd.reviewStatus} /><p className="readonly-note">Existing ads keep the creative version they were created with.</p></div></div></section>;
  }

  const busy = pending || localPending;
  const submit = async () => {
    if (!owner || inFlight.current || busy || !adSetId || !selectedOption || !selectedDestination || adName.trim().length < 2 || adName.trim().length > 120) return;
    inFlight.current = true;
    setLocalPending(true);
    try {
      await onCreate({ adSetId, creativeVersionId: selectedOption.version.id, destinationId: selectedDestination.id, name: adName.trim() });
    } finally {
      inFlight.current = false;
      setLocalPending(false);
    }
  };

  return <section id="ad" className="business-card editor-card"><p className="eyebrow">Step 7</p><h2>Ad assembly</h2><p>Choose the creative and destination this ad will use.</p>
    {!adSetId ? <p>Create or select an Ad Set first.</p> : <form className="seller-form" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <FormField label="Ad name" hint="Only you see this name."><input minLength={2} maxLength={120} required disabled={busy} value={adName} onChange={(event) => setAdName(event.target.value)} /></FormField>
      <fieldset className="ads-choice-fieldset"><legend>Creative</legend>{options.length === 0 ? <p>Create a Creative first.</p> : <div className="ads-choice-grid">{options.map(({ creative, version }) => <label className={version.id === creativeVersionId ? "ads-choice-card is-selected" : "ads-choice-card"} key={version.id}><input type="radio" name="ad-creative" disabled={busy} checked={version.id === creativeVersionId} onChange={() => setCreativeVersionId(version.id)} /><span><strong>{creative.name}</strong><small>{version.headline ?? version.primaryText ?? ctaLabel(version.callToAction)}</small></span></label>)}</div>}</fieldset>
      <fieldset className="ads-choice-fieldset"><legend>Destination</legend><div className="ads-choice-grid">{destinations.map((destination) => {
        const usable = isCurrentReleaseDestination(destination);
        return <label className={destination.id === selectedDestinationId ? "ads-choice-card is-selected" : "ads-choice-card"} aria-disabled={!usable || busy} key={destination.id}><input type="radio" name="ad-destination" disabled={!usable || busy} checked={destination.id === selectedDestinationId} onChange={() => onSelectDestination(destination.id)} /><span><strong>{destination.destinationType === "external_url" ? "External website" : "Not available yet"}</strong><small>{usable ? destinationSummary(destination) : "This destination is not available for this release."}</small></span></label>;
      })}</div></fieldset>
      {selectedOption && selectedDestination && <div className="ads-combined-preview"><CreativePreview name={selectedOption.creative.name} version={selectedOption.version} media={versionMedia(selectedOption.version, mediaById)} /><div><span className="ads-preview-label">Destination</span><strong>{destinationSummary(selectedDestination)}</strong><span>Preview links are disabled.</span></div></div>}
      <div className="compact-actions"><button className="primary-button" type="submit" disabled={!owner || busy || !selectedOption || !selectedDestination}>{busy ? "Saving…" : forceCreate ? "Create revised ad" : "Create ad"}</button>{forceCreate && <button className="secondary-button" type="button" disabled={busy} onClick={onCancelCreate}>Cancel</button>}</div>
    </form>}
  </section>;
}
