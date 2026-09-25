import { useRef, useState } from "react";
import type { AdvertisingAd, AdvertisingCreativeVersion, AdvertisingDestination } from "../../lib/adsManagerApi";
import type { BusinessMediaItem } from "../../lib/businessMediaApi";
import { formatDate } from "../../lib/businessFormat";
import { BusinessConfirmDialog } from "../BusinessConfirmDialog";
import { CreativePreview, destinationSummary } from "./CreativeAdPanels";

const REJECTION_MESSAGES: Record<string, string> = {
  policy_violation: "This ad does not meet advertising policy.",
  misleading: "This ad may be misleading.",
  unsafe_destination: "The destination could not be approved.",
  prohibited_content: "This ad contains prohibited content.",
  restricted_content: "This ad contains restricted content.",
  media_invalid: "The ad media could not be approved.",
  copy_invalid: "The ad copy could not be approved.",
  other: "This ad needs changes before it can be approved.",
};

function rejectionMessage(ad: AdvertisingAd) {
  return ad.latestRejectionMessage
    ?? (ad.latestRejectionReasonCode ? REJECTION_MESSAGES[ad.latestRejectionReasonCode] : null)
    ?? "This ad needs changes before it can be approved.";
}

export function BusinessReviewPanel({ ad, creativeName, version, media, destination, owner, pending, onSubmit, onCreateRevised }: {
  ad: AdvertisingAd | null;
  creativeName: string | null;
  version: AdvertisingCreativeVersion | null;
  media: BusinessMediaItem | null;
  destination: AdvertisingDestination | null;
  owner: boolean;
  pending: boolean;
  onSubmit: () => Promise<boolean>;
  onCreateRevised: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [localPending, setLocalPending] = useState(false);
  const inFlight = useRef(false);
  if (!ad) return <section id="review" className="business-card editor-card"><p className="eyebrow">Step 8</p><h2>Review</h2><p>Assemble an Ad first.</p></section>;

  const submit = async () => {
    if (!owner || pending || localPending || inFlight.current || ad.reviewStatus !== "not_submitted") return;
    inFlight.current = true;
    setLocalPending(true);
    try { await onSubmit(); }
    finally {
      inFlight.current = false;
      setLocalPending(false);
      setConfirming(false);
    }
  };
  const busy = pending || localPending;
  const status = ad.reviewStatus === "pending" ? "In review"
    : ad.reviewStatus === "approved" ? "Approved"
      : ad.reviewStatus === "rejected" ? "Needs changes" : "Ready for review";

  return <section id="review" className="business-card editor-card business-review-panel" aria-busy={busy}>
    <p className="eyebrow">Step 8</p>
    <div className="section-heading"><div><h2>Review</h2><p>Review the exact creative and destination attached to this ad.</p></div><span className={`ads-review-status status-${ad.reviewStatus}`}>{status}</span></div>
    <div className="ads-review-assembly">
      {version && <CreativePreview name={creativeName ?? ad.name} version={version} media={media} />}
      <div className="ads-review-summary"><span>Ad</span><strong>{ad.name}</strong><span>Destination</span><strong>{destination ? destinationSummary(destination) : "Destination details unavailable"}</strong>{ad.submittedAt && <><span>Submitted</span><strong>{formatDate(ad.submittedAt)}</strong></>}</div>
    </div>
    {ad.reviewStatus === "not_submitted" && <div className="ads-review-callout"><strong>Ready for review</strong><p>Submit this ad so Nelyon can review its creative and destination.</p>{owner && <button className="primary-button" type="button" disabled={busy} onClick={() => setConfirming(true)}>Submit for review</button>}</div>}
    {ad.reviewStatus === "pending" && <div className="readonly-note" role="status"><strong>In review</strong><span>Nelyon is reviewing the submitted creative and destination.</span></div>}
    {ad.reviewStatus === "approved" && <div className="inline-success" role="status"><strong>Approved</strong><span>This ad has been approved. Campaign delivery remains subject to readiness and pre-launch controls.</span></div>}
    {ad.reviewStatus === "rejected" && <div className="ads-review-callout needs-attention" role="status"><strong>Needs changes</strong><p>{rejectionMessage(ad)}</p><p>Update the creative or destination if needed, then create a revised ad for review.</p>{owner && <button className="primary-button" type="button" onClick={onCreateRevised}>Create revised ad</button>}</div>}
    <BusinessConfirmDialog open={confirming} title="Submit this ad for review?" description="The exact current Ad will be submitted. Later Creative versions do not change this submitted Ad. Nelyon may approve it or request changes." confirmLabel="Confirm submission" pendingLabel="Submitting…" pending={busy} onCancel={() => setConfirming(false)} onConfirm={() => void submit()} />
  </section>;
}
