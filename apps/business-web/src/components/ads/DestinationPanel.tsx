import { useEffect, useState } from "react";
import type { AdvertisingDestination } from "../../lib/adsManagerApi";
import type { MarketplaceStore } from "../../lib/businessApi";
import type { ProductSummary } from "../../lib/sellerCenterApi";
import { destinationLabel, destinationOrder, destinationSupport, externalWebsiteSummary, isApprovedAppStoreWebsite, isCurrentReleaseDestination, validateExternalWebsite, type DestinationType } from "../../lib/adsPlacementDestinationUx";

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
  objective?: string;
  products?: ProductSummary[];
  productsLoading?: boolean;
  productsError?: string | null;
  store?: MarketplaceStore | null;
  onSave: (values: DestinationValues) => Promise<boolean>;
};

export function DestinationPanel({ destination, referencedByAd, owner, pending, objective = "awareness", products = [], productsLoading = false, productsError = null, store = null, onSave }: Props) {
  const commerce = objective === "marketplace_sales";
  const objectiveType: DestinationType = commerce ? "marketplace_product"
    : objective === "profile_visits" ? "nelyon_profile"
      : objective === "messages" ? "nelyon_message" : "external_url";
  const supportedExisting = isCurrentReleaseDestination(destination, objective);
  const initialType = supportedExisting ? destination!.destinationType as DestinationType : objectiveType;
  const [editing, setEditing] = useState(!destination);
  const [type, setType] = useState<DestinationType>(initialType);
  const [website, setWebsite] = useState(destination?.externalUrl ?? "");
  const [productId, setProductId] = useState(destination?.targetProductId ?? "");
  const [storeId, setStoreId] = useState(destination?.targetStoreId ?? store?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEditing(!destination);
    setType(destination && isCurrentReleaseDestination(destination, objective) ? destination.destinationType as DestinationType : objectiveType);
    setWebsite(destination?.externalUrl ?? "");
    setProductId(destination?.targetProductId ?? "");
    setStoreId(destination?.targetStoreId ?? store?.id ?? "");
    setError(null);
  }, [destination, objective, objectiveType, store?.id]);
  const validated = validateExternalWebsite(website);
  const canonicalUrl = validated.ok ? validated.value : null;
  const existingValidated = validateExternalWebsite(destination?.externalUrl ?? "");
  const unchanged = destination?.destinationType === type && (
    (type === "external_url" && existingValidated.ok && existingValidated.value === canonicalUrl)
    || (type === "marketplace_product" && destination.targetProductId === productId)
    || (type === "marketplace_store" && destination.targetStoreId === storeId)
    || (["nelyon_profile", "nelyon_message"].includes(type) && destination.targetUserId != null)
  );
  const canEdit = owner && !pending && !referencedByAd && destination?.status === "draft";
  const permitted = destination ? canEdit : owner && !pending;
  const hasChanges = !destination || !unchanged;
  const targetReady = type === "external_url" ? Boolean(website.trim()) : type === "marketplace_product" ? Boolean(productId) : type === "marketplace_store" ? Boolean(storeId) : ["nelyon_profile", "nelyon_message"].includes(type);
  const canSave = permitted && targetReady && hasChanges;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!permitted || !hasChanges) return;
    if (commerce && type === "external_url") { setError("Marketplace sales requires a Marketplace product or store destination."); return; }
    if (objective === "profile_visits" && type !== "nelyon_profile") { setError("Profile visits requires your canonical Nelyon profile destination."); return; }
    if (objective === "messages" && type !== "nelyon_message") { setError("Messages requires the canonical Nelyon message destination."); return; }
    const result = type === "external_url" ? validateExternalWebsite(website) : null;
    if (result && !result.ok) { setError(result.message); return; }
    if (objective === "app_promotion" && !isApprovedAppStoreWebsite(website)) { setError("Use an approved apps.apple.com or play.google.com HTTPS address."); return; }
    if (type === "marketplace_product" && !productId) { setError("Select an eligible Marketplace product."); return; }
    if (type === "marketplace_store" && !storeId) { setError("Select an active Marketplace store."); return; }
    setError(null);
    const values: DestinationValues = {
      type,
      externalUrl: result?.ok ? result.value : null,
      targetUserId: ["nelyon_profile", "nelyon_message"].includes(type) ? destination?.targetUserId ?? null : null,
      targetBusinessAccountId: null,
      targetProductId: type === "marketplace_product" ? productId : null,
      targetStoreId: type === "marketplace_store" ? storeId : null,
    };
    void onSave(values).then((saved) => { if (saved) setEditing(false); });
  };

  return <section id="destination" className="business-card editor-card ads-choice-panel">
    <p className="eyebrow">Step 5</p><h2>Destination</h2>
    <p className="muted-copy">Where should people go after they interact with your ad?</p>
    {destination && !editing && <>
      <div className="ads-destination-summary"><span>{destinationLabel(destination.destinationType)}</span><strong>{destination.destinationType === "external_url" ? externalWebsiteSummary(destination.externalUrl) : destination.destinationType === "marketplace_product" ? products.find((item) => item.id === destination.targetProductId)?.title ?? "Marketplace product" : destination.destinationType === "marketplace_store" ? store?.name ?? "Marketplace store" : "Saved destination"}</strong></div>
      {referencedByAd && <div className="readonly-note">This destination is already attached to an ad and can't be changed here.</div>}
      {destination.status !== "draft" && !referencedByAd && <div className="readonly-note">Only draft destinations can be edited.</div>}
      {!supportedExisting && <div className="readonly-note">{commerce ? "This saved destination is not available for this Ads V2 release. Choose a Marketplace product or store to continue." : "This saved destination is not available for this Ads V2 release. Replace it with an External website to continue."}</div>}
      {commerce && destination.destinationType === "external_url" && <div className="readonly-note">Marketplace sales requires a Marketplace product or store destination.</div>}
      <button type="button" className="secondary-button" disabled={!canEdit} onClick={() => setEditing(true)}>Edit destination</button>
    </>}
    {editing && <form className="seller-form" aria-busy={pending} onSubmit={submit}>
      <fieldset className="ads-card-fieldset"><legend>Destination type</legend><div className="ads-destination-grid">
        {destinationOrder.map((destinationType) => {
          const support = destinationSupport[destinationType];
          const selectable = commerce
            ? destinationType === "marketplace_product" || destinationType === "marketplace_store"
            : objective === "profile_visits" ? destinationType === "nelyon_profile"
              : objective === "messages" ? destinationType === "nelyon_message"
                : destinationType === "external_url";
          return <label key={destinationType} className={`ads-destination-card${type === destinationType ? " is-selected" : ""}${!selectable ? " is-disabled" : ""}`}>
            <input type="radio" name="destination-type" value={destinationType} checked={type === destinationType} disabled={!selectable || pending} onChange={() => { setType(destinationType); setWebsite(""); setProductId(""); setStoreId(store?.id ?? ""); setError(null); }} />
            <span className="ads-card-copy"><strong>{support.label}</strong><span>{support.description}</span><small>{selectable ? "Available" : "Not available for this objective"}</small></span>
          </label>;
        })}
      </div></fieldset>
      {type === "external_url" && <label className="form-field"><span>Website URL</span><input aria-label="Website URL" type="url" inputMode="url" autoComplete="url" placeholder="https://example.com" value={website} aria-invalid={Boolean(error)} aria-describedby={error ? "destination-url-error" : "destination-url-help"} onChange={(event) => { setWebsite(event.target.value); setError(null); }} /><small id="destination-url-help">Use a secure HTTPS website address.</small>{error && <small id="destination-url-error" className="field-error" role="alert">{error}</small>}</label>}
      {objective === "app_promotion" && type === "external_url" && <div className="readonly-note"><strong>App-store destination required.</strong><span>Use apps.apple.com or play.google.com. Store visits are measured; installs not measured.</span></div>}
      {type === "nelyon_profile" && <div className="readonly-note">The server binds this destination to your authenticated Nelyon profile.</div>}
      {type === "nelyon_message" && <div className="readonly-note">The server binds this destination to your authenticated Nelyon messaging identity. Opening Chat does not count as a conversation started.</div>}
      {type === "marketplace_product" && <label className="form-field"><span>Marketplace product</span><select aria-label="Marketplace product" value={productId} disabled={productsLoading} onChange={(event) => { setProductId(event.target.value); setError(null); }}><option value="">{productsLoading ? "Loading eligible products…" : "Select an eligible product"}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}</select>{productsError && <small className="field-error" role="alert">{productsError}</small>}{!productsLoading && !productsError && products.length === 0 && <small>No active, ready Marketplace products are available.</small>}</label>}
      {type === "marketplace_store" && <label className="form-field"><span>Marketplace store</span><select aria-label="Marketplace store" value={storeId} onChange={(event) => { setStoreId(event.target.value); setError(null); }}><option value="">Select an active store</option>{store?.status === "active" && <option value={store.id}>{store.name}</option>}</select>{store?.status !== "active" && <small>No active Marketplace store is available.</small>}</label>}
      {type !== "external_url" && error && <small className="field-error" role="alert">{error}</small>}
      <div className="compact-actions"><button className="primary-button" disabled={!canSave} type="submit">{pending ? "Saving…" : destination ? "Save changes" : "Create destination"}</button>{destination && <button className="secondary-button" type="button" disabled={pending} onClick={() => { setEditing(false); setWebsite(destination.externalUrl ?? ""); setProductId(destination.targetProductId ?? ""); setStoreId(destination.targetStoreId ?? store?.id ?? ""); setError(null); }}>Cancel editing</button>}</div>
    </form>}
  </section>;
}
