import { useEffect, useState } from "react";
import type { AdvertisingDestination } from "../../lib/adsManagerApi";
import { destinationLabel, destinationOrder, destinationSupport, externalWebsiteSummary, validateExternalWebsite, type DestinationType } from "../../lib/adsPlacementDestinationUx";

export type DestinationValues = {
  type: DestinationType;
  externalUrl: string | null;
  targetUserId: string | null;
  targetBusinessAccountId: string | null;
  targetProductId: string | null;
  targetStoreId: string | null;
};

type Props = {
  destination: AdvertisingDestination | null;
  referencedByAd: boolean;
  owner: boolean;
  pending: boolean;
  onSave: (values: DestinationValues) => Promise<boolean>;
};

export function DestinationPanel({ destination, referencedByAd, owner, pending, onSave }: Props) {
  const supportedExisting = destination?.destinationType === "external_url";
  const [editing, setEditing] = useState(!destination);
  const [type, setType] = useState<DestinationType>(destination?.destinationType === "external_url" ? "external_url" : "external_url");
  const [website, setWebsite] = useState(destination?.externalUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEditing(!destination); setType(destination?.destinationType === "external_url" ? "external_url" : "external_url"); setWebsite(destination?.externalUrl ?? ""); setError(null); }, [destination]);
  const validated = validateExternalWebsite(website);
  const canonicalUrl = validated.ok ? validated.value : null;
  const existingValidated = validateExternalWebsite(destination?.externalUrl ?? "");
  const unchanged = destination?.destinationType === "external_url" && existingValidated.ok && existingValidated.value === canonicalUrl;
  const canEdit = owner && !pending && !referencedByAd && destination?.status === "draft";
  const permitted = destination ? canEdit : owner && !pending;
  const hasChanges = !destination || !unchanged;
  const canSave = permitted && Boolean(website.trim()) && hasChanges;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!permitted || !hasChanges) return;
    const result = validateExternalWebsite(website);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    const values: DestinationValues = { type, externalUrl: result.value, targetUserId: null, targetBusinessAccountId: null, targetProductId: null, targetStoreId: null };
    void onSave(values).then((saved) => { if (saved) setEditing(false); });
  };

  return <section id="destination" className="business-card editor-card ads-choice-panel">
    <p className="eyebrow">Step 5</p><h2>Destination</h2>
    <p className="muted-copy">Where should people go after they interact with your ad?</p>
    {destination && !editing && <>
      <div className="ads-destination-summary"><span>{destinationLabel(destination.destinationType)}</span><strong>{destination.destinationType === "external_url" ? externalWebsiteSummary(destination.externalUrl) : "Saved destination"}</strong></div>
      {referencedByAd && <div className="readonly-note">This destination is already attached to an ad and can't be changed here.</div>}
      {destination.status !== "draft" && !referencedByAd && <div className="readonly-note">Only draft destinations can be edited.</div>}
      {!supportedExisting && <div className="readonly-note">This saved destination is not available for this Ads V2 release. Replace it with an External website to continue.</div>}
      <button type="button" className="secondary-button" disabled={!canEdit} onClick={() => setEditing(true)}>Edit destination</button>
    </>}
    {editing && <form className="seller-form" aria-busy={pending} onSubmit={submit}>
      <fieldset className="ads-card-fieldset"><legend>Destination type</legend><div className="ads-destination-grid">
        {destinationOrder.map((destinationType) => {
          const support = destinationSupport[destinationType];
          return <label key={destinationType} className={`ads-destination-card${type === destinationType ? " is-selected" : ""}${!support.selectable ? " is-disabled" : ""}`}>
            <input type="radio" name="destination-type" value={destinationType} checked={type === destinationType} disabled={!support.selectable || pending} onChange={() => { setType(destinationType); setWebsite(""); setError(null); }} />
            <span className="ads-card-copy"><strong>{support.label}</strong><span>{support.description}</span><small>{support.selectable ? "Available" : "Not available yet"}</small></span>
          </label>;
        })}
      </div></fieldset>
      {type === "external_url" && <label className="form-field"><span>Website URL</span><input aria-label="Website URL" type="url" inputMode="url" autoComplete="url" placeholder="https://example.com" value={website} aria-invalid={Boolean(error)} aria-describedby={error ? "destination-url-error" : "destination-url-help"} onChange={(event) => { setWebsite(event.target.value); setError(null); }} /><small id="destination-url-help">Use a secure HTTPS website address.</small>{error && <small id="destination-url-error" className="field-error" role="alert">{error}</small>}</label>}
      <div className="compact-actions"><button className="primary-button" disabled={!canSave} type="submit">{pending ? "Saving…" : destination ? "Save changes" : "Create destination"}</button>{destination && <button className="secondary-button" type="button" disabled={pending} onClick={() => { setEditing(false); setWebsite(destination.externalUrl ?? ""); setError(null); }}>Cancel editing</button>}</div>
    </form>}
  </section>;
}
