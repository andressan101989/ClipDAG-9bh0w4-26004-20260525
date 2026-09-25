import { useEffect, useMemo, useState } from "react";
import { isCurrentReleasePlacementSelection, placementCards } from "../../lib/adsPlacementDestinationUx";

type Props = {
  savedCodes: string[];
  hasSelection: boolean;
  owner: boolean;
  pending: boolean;
  supportAvailable: boolean;
  onSave: (codes: string[]) => Promise<boolean>;
};

export function PlacementSelectionPanel({ savedCodes, hasSelection, owner, pending, supportAvailable, onSave }: Props) {
  const savedKey = [...savedCodes].sort().join("\u0000");
  const [editing, setEditing] = useState(!hasSelection);
  const [selected, setSelected] = useState<string[]>(hasSelection ? savedCodes : []);
  useEffect(() => { setSelected(hasSelection && savedKey ? savedKey.split("\u0000") : []); setEditing(!hasSelection); }, [hasSelection, savedKey]);
  const cards = useMemo(() => placementCards(savedCodes), [savedCodes]);
  const needsAttention = hasSelection && !isCurrentReleasePlacementSelection(savedCodes);
  const unchanged = [...selected].sort().join("\u0000") === [...savedCodes].sort().join("\u0000");
  const canSave = owner && !pending && supportAvailable && selected.length > 0 && selected.every((code) => code === "social_feed") && (!hasSelection || !unchanged);

  const toggle = (code: string, selectable: boolean) => {
    setSelected((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : selectable ? [...current, code] : current);
  };

  return <section id="placements" className="business-card editor-card ads-choice-panel">
    <p className="eyebrow">Step 4</p><h2>Placements</h2>
    <p className="muted-copy">Where should your ad appear?</p>
    {!supportAvailable && <div className="readonly-note" role="status">Placement settings are temporarily unavailable. Try again.</div>}
    {!editing && <>
      {needsAttention && <div className="ads-attention-note" role="status"><strong>Selected previously — not available for this Ads V2 release</strong><span>Review this selection before the campaign can continue.</span></div>}
      <div className="ads-selection-summary" aria-label="Saved placements">
        {cards.filter((item) => item.selectedPreviously).map((item) => <article key={item.code} className={item.needsAttention ? "ads-summary-item needs-attention" : "ads-summary-item"}>
          <strong>{item.label}</strong><span>{item.needsAttention ? item.state === "legacy_separate" ? "Separate Marketplace promotion" : "Needs attention" : "Selected"}</span>
        </article>)}
      </div>
      <p className="ads-prelaunch-note">Ad delivery is not enabled yet.</p>
      <button type="button" className="secondary-button" disabled={!owner || pending || !supportAvailable} onClick={() => setEditing(true)}>{needsAttention ? "Review placements" : "Edit placements"}</button>
    </>}
    {editing && <form aria-busy={pending} onSubmit={(event) => { event.preventDefault(); if (!canSave) return; void onSave(selected).then((saved) => { if (saved) setEditing(false); }); }}>
      <fieldset className="ads-card-fieldset"><legend className="sr-only">Choose placements</legend><div className="ads-placement-grid">
        {cards.map((item) => {
          const checked = selected.includes(item.code);
          const disabled = !owner || pending || !supportAvailable || (!item.selectable && !checked);
          return <label key={item.code} className={`ads-placement-card${checked ? " is-selected" : ""}${item.needsAttention && checked ? " needs-attention" : ""}${disabled ? " is-disabled" : ""}`}>
            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(item.code, item.selectable)} aria-describedby={`placement-${item.code}-status`} />
            <span className="ads-card-copy"><strong>{item.label}</strong><span>{item.description}</span><small id={`placement-${item.code}-status`}>{checked && !item.selectable ? "Selected previously — remove to continue" : item.status}</small></span>
          </label>;
        })}
      </div></fieldset>
      {selected.length === 0 && <p className="field-error">Choose at least one available placement.</p>}
      <p className="ads-prelaunch-note">Delivery is currently paused during pre-launch.</p>
      <div className="compact-actions"><button className="primary-button" disabled={!owner || pending || !canSave} type="submit">{pending ? "Saving…" : hasSelection ? "Create updated placement version" : "Save placements"}</button>{hasSelection && <button className="secondary-button" type="button" disabled={pending} onClick={() => { setSelected(savedCodes); setEditing(false); }}>Cancel editing</button>}</div>
    </form>}
  </section>;
}
