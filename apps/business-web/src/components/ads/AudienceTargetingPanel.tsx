import { useEffect, useMemo, useRef, useState } from "react";
import type { AdvertisingAudienceDefinition, AdvertisingTargetingCapabilities } from "../../lib/adsManagerApi";
import { areAdsMutationPayloadsEquivalent } from "../../lib/adsMutationCoordinator";
import {
  AUDIENCE_WEEKDAYS,
  audienceCapabilitiesAreSafe,
  browserTimeZone,
  createAudienceFormState,
  formatAudienceFrequency,
  formatAudienceSchedule,
  formatFrequencyWindow,
  newAudienceDaypart,
  serializeAudienceForm,
  supportedTimeZones,
  validateAudienceForm,
  type AudienceFormState,
} from "../../lib/audienceTargetingUx";

type Props = {
  audienceIdentity: string | null;
  definition: AdvertisingAudienceDefinition | null;
  exists: boolean;
  stale: boolean;
  capabilities: AdvertisingTargetingCapabilities | null;
  capabilitiesUnavailable: boolean;
  owner: boolean;
  pending: boolean;
  onSave: (definition: AdvertisingAudienceDefinition) => Promise<boolean>;
};

const capabilityLabels: Array<[keyof AdvertisingTargetingCapabilities, string]> = [
  ["geoTargetingEnabled", "Location"],
  ["languageTargetingEnabled", "Language"],
  ["interestTargetingEnabled", "Interests"],
  ["behavioralTargetingEnabled", "Behavioral targeting"],
  ["customAudiencesEnabled", "Custom audiences"],
  ["lookalikeTargetingEnabled", "Lookalike audiences"],
];

export function AudienceTargetingPanel({ audienceIdentity, definition, exists, stale, capabilities, capabilitiesUnavailable, owner, pending, onSave }: Props) {
  const suggestedTimezone = browserTimeZone();
  const [editing, setEditing] = useState(!exists);
  const [form, setForm] = useState<AudienceFormState>(() => createAudienceFormState(definition, suggestedTimezone));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const previousCanonical = useRef({ audienceIdentity, definition });
  const timezones = useMemo(() => supportedTimeZones(suggestedTimezone), [suggestedTimezone]);
  const serialized = useMemo(() => serializeAudienceForm(form), [form]);
  const unchanged = !stale && definition != null && areAdsMutationPayloadsEquivalent(definition, serialized);
  const capabilitiesSafe = audienceCapabilitiesAreSafe(capabilities);
  const effectiveCapabilitiesUnavailable = capabilitiesUnavailable || !capabilitiesSafe;
  const saveDisabled = !owner || effectiveCapabilitiesUnavailable || pending || unchanged;

  useEffect(() => {
    const previous = previousCanonical.current;
    const sameAudience = previous.audienceIdentity === audienceIdentity;
    const sameDefinition = areAdsMutationPayloadsEquivalent(previous.definition, definition);
    previousCanonical.current = { audienceIdentity, definition };
    if (editing && exists && sameAudience && sameDefinition) return;
    setForm(createAudienceFormState(definition, suggestedTimezone));
    setFieldErrors({});
    setEditing(!exists);
  }, [audienceIdentity, definition, editing, exists, suggestedTimezone]);

  function updateForm(update: (current: AudienceFormState) => AudienceFormState) {
    setForm((current) => update(current));
    setFieldErrors({});
  }

  function startEditing() {
    setForm(createAudienceFormState(definition, suggestedTimezone));
    setFieldErrors({});
    setEditing(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saveDisabled) return;
    const validation = validateAudienceForm(form);
    if (!validation.valid) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    if (await onSave(serialized)) setEditing(false);
  }

  const schedule = formatAudienceSchedule(definition?.dayparts ?? []);
  return <section id="audience" className="business-card editor-card audience-targeting-panel">
    <p className="eyebrow">Step 3</p>
    <div className="section-heading">
      <div><h2>Audience</h2><p>Choose who can see this ad, when it can appear, and how often it may be shown.</p></div>
      {exists && !editing && <button type="button" className="secondary-button" disabled={!owner || pending || effectiveCapabilitiesUnavailable} onClick={startEditing}>{stale ? "Review audience" : "Edit audience"}</button>}
    </div>

    {stale && <div className="audience-attention" role="status"><strong>Your audience settings need to be reviewed before this campaign can continue.</strong><span>Review and save the settings to bring this audience up to date.</span></div>}
    {effectiveCapabilitiesUnavailable && <div className="audience-attention" role="status">Targeting settings are temporarily unavailable. Try again.</div>}

    {exists && definition && !editing && <div className="audience-summary" aria-label="Audience summary">
      <AudienceSummaryItem label="Audience" primary="Adults 18+" />
      <div className="audience-summary-item"><span>Schedule</span>{schedule.map((item, index) => <div key={`${item.primary}-${item.secondary ?? index}`}><strong>{item.primary}</strong>{item.secondary && <small>{item.secondary}</small>}</div>)}</div>
      <AudienceSummaryItem label="Frequency" primary={formatAudienceFrequency(definition.frequency)} />
      <AudienceSummaryItem label="Location" primary="Not used" />
      <AudienceSummaryItem label="Language" primary="Not used" />
    </div>}

    {editing && <form className="audience-editor" aria-busy={pending} onSubmit={submit} noValidate>
      <fieldset className="audience-section">
        <legend>Who can see this ad?</legend>
        <div className="audience-required-card" aria-label="Adults 18+ selected and required">
          <span className="audience-lock" aria-hidden="true">✓</span>
          <div><strong>Adults 18+</strong><small>Selected · Required</small><p>Ads currently target adults age 18 and over.</p></div>
        </div>
      </fieldset>

      <fieldset className="audience-section">
        <legend>When can people see this ad?</legend>
        <div className="audience-segmented">
          <label className={form.scheduleMode === "any_time" ? "is-selected" : ""}><input type="radio" name="schedule-mode" checked={form.scheduleMode === "any_time"} onChange={() => updateForm((current) => ({ ...current, scheduleMode: "any_time" }))} />Any time</label>
          <label className={form.scheduleMode === "custom" ? "is-selected" : ""}><input type="radio" name="schedule-mode" checked={form.scheduleMode === "custom"} onChange={() => updateForm((current) => ({ ...current, scheduleMode: "custom", dayparts: current.dayparts.length ? current.dayparts : [newAudienceDaypart(current.suggestedTimezone)] }))} />Custom schedule</label>
        </div>
        {form.scheduleMode === "custom" && <div className="audience-dayparts">
          {form.dayparts.map((row, index) => {
            const prefix = `daypart.${row.key}`;
            return <fieldset key={row.key} className="audience-daypart" aria-label={`Schedule window ${index + 1}`}>
              <legend>Schedule window {index + 1}</legend>
              <label>Day<select value={row.weekday} aria-invalid={Boolean(fieldErrors[`${prefix}.weekday`])} aria-describedby={fieldErrors[`${prefix}.weekday`] ? `${prefix}-weekday-error` : undefined} onChange={(event) => updateForm((current) => ({ ...current, dayparts: current.dayparts.map((item) => item.key === row.key ? { ...item, weekday: event.target.value } : item) }))}>{AUDIENCE_WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select>{fieldErrors[`${prefix}.weekday`] && <span id={`${prefix}-weekday-error`} className="field-error" role="alert">{fieldErrors[`${prefix}.weekday`]}</span>}</label>
              <label>Start time<input type="time" value={row.start} aria-invalid={Boolean(fieldErrors[`${prefix}.start`])} aria-describedby={fieldErrors[`${prefix}.start`] ? `${prefix}-start-error` : undefined} onChange={(event) => updateForm((current) => ({ ...current, dayparts: current.dayparts.map((item) => item.key === row.key ? { ...item, start: event.target.value } : item) }))} />{fieldErrors[`${prefix}.start`] && <span id={`${prefix}-start-error`} className="field-error" role="alert">{fieldErrors[`${prefix}.start`]}</span>}</label>
              <label>End time<input type="time" value={row.end} aria-invalid={Boolean(fieldErrors[`${prefix}.end`])} aria-describedby={fieldErrors[`${prefix}.end`] ? `${prefix}-end-error` : undefined} onChange={(event) => updateForm((current) => ({ ...current, dayparts: current.dayparts.map((item) => item.key === row.key ? { ...item, end: event.target.value } : item) }))} />{fieldErrors[`${prefix}.end`] && <span id={`${prefix}-end-error`} className="field-error" role="alert">{fieldErrors[`${prefix}.end`]}</span>}</label>
              <label>Time zone<input list="audience-timezones" value={row.timezone} aria-invalid={Boolean(fieldErrors[`${prefix}.timezone`])} aria-describedby={fieldErrors[`${prefix}.timezone`] ? `${prefix}-timezone-help ${prefix}-timezone-error` : `${prefix}-timezone-help`} onChange={(event) => updateForm((current) => ({ ...current, dayparts: current.dayparts.map((item) => item.key === row.key ? { ...item, timezone: event.target.value } : item) }))} /><small id={`${prefix}-timezone-help`}>The schedule follows this time zone.</small>{fieldErrors[`${prefix}.timezone`] && <span id={`${prefix}-timezone-error`} className="field-error" role="alert">{fieldErrors[`${prefix}.timezone`]}</span>}</label>
              <button type="button" className="text-button audience-remove-window" onClick={() => updateForm((current) => ({ ...current, dayparts: current.dayparts.filter((item) => item.key !== row.key) }))}>Remove schedule window</button>
            </fieldset>;
          })}
          <datalist id="audience-timezones">{timezones.map((timezone) => <option key={timezone} value={timezone} />)}</datalist>
          {fieldErrors.schedule && <span className="field-error" role="alert">{fieldErrors.schedule}</span>}
          <button type="button" className="secondary-button audience-add-window" disabled={form.dayparts.length >= 100} onClick={() => updateForm((current) => ({ ...current, dayparts: [...current.dayparts, newAudienceDaypart(current.suggestedTimezone)] }))}>Add schedule window</button>
        </div>}
      </fieldset>

      <fieldset className="audience-section">
        <legend>How often can they see it?</legend>
        <p>Limit how often the same person can see this ad.</p>
        <label className="audience-toggle"><input type="checkbox" checked={form.frequency.enabled} onChange={(event) => updateForm((current) => ({ ...current, frequency: { ...current.frequency, enabled: event.target.checked } }))} />Limit frequency</label>
        {form.frequency.enabled && <div className="audience-frequency-grid">
          <label>Maximum impressions<select value={form.frequency.maxImpressions} aria-invalid={Boolean(fieldErrors.maxImpressions)} aria-describedby={fieldErrors.maxImpressions ? "audience-max-impressions-error" : undefined} onChange={(event) => updateForm((current) => ({ ...current, frequency: { ...current.frequency, maxImpressions: event.target.value } }))}>{Array.from({ length: 20 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select>{fieldErrors.maxImpressions && <span id="audience-max-impressions-error" className="field-error" role="alert">{fieldErrors.maxImpressions}</span>}</label>
          <label>Time window<select value={form.frequency.windowHours} aria-invalid={Boolean(fieldErrors.windowHours)} aria-describedby={fieldErrors.windowHours ? "audience-window-hours-error" : undefined} onChange={(event) => updateForm((current) => ({ ...current, frequency: { ...current.frequency, windowHours: event.target.value } }))}>{Array.from({ length: 168 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{formatFrequencyWindow(value)}</option>)}</select>{fieldErrors.windowHours && <span id="audience-window-hours-error" className="field-error" role="alert">{fieldErrors.windowHours}</span>}</label>
        </div>}
      </fieldset>

      <fieldset className="audience-section">
        <legend>Additional targeting</legend>
        <div className="audience-capability-grid">{capabilityLabels.map(([key, label]) => <article key={key}><h3>{label}</h3><strong>Not available yet</strong></article>)}</div>
        <p className="audience-privacy-note">Nelyon does not use sensitive targeting or precise viewer location for this audience.</p>
      </fieldset>

      {unchanged && <p className="muted-copy" role="status">No changes to save.</p>}
      <div className="compact-actions"><button className="primary-button" disabled={saveDisabled} type="submit">{pending ? "Saving…" : exists ? "Save changes" : "Create audience"}</button>{exists && <button className="secondary-button" type="button" disabled={pending} onClick={() => { setForm(createAudienceFormState(definition, suggestedTimezone)); setFieldErrors({}); setEditing(false); }}>Cancel editing</button>}</div>
    </form>}
  </section>;
}

function AudienceSummaryItem({ label, primary }: { label: string; primary: string }) {
  return <div className="audience-summary-item"><span>{label}</span><strong>{primary}</strong></div>;
}
