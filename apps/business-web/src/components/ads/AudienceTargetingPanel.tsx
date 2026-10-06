import { useEffect, useMemo, useRef, useState } from "react";
import type { AdvertisingAudienceDefinition, AdvertisingTargetingCapabilities } from "../../lib/adsManagerApi";
import { areAdsMutationPayloadsEquivalent } from "../../lib/adsMutationCoordinator";
import {
  AUDIENCE_WEEKDAYS,
  audienceCapabilitiesAreSafe,
  browserTimeZone,
  createAudienceFormState,
  formatAudienceAgeRange,
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

const capabilityLabels: [keyof AdvertisingTargetingCapabilities, string][] = [
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
  const [form, setForm] = useState<AudienceFormState>(() => createAudienceFormState(definition, suggestedTimezone, capabilities));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const previousCanonical = useRef({ audienceIdentity, definition });
  const timezones = useMemo(() => supportedTimeZones(suggestedTimezone), [suggestedTimezone]);
  const serialized = useMemo(() => serializeAudienceForm(form), [form]);
  const comparableDefinition = definition?.age_scope === "adults_only"
    ? { ...definition, age_scope: "age_range" as const, min_age: 18, max_age: null }
    : definition;
  const unchanged = !stale && comparableDefinition != null && areAdsMutationPayloadsEquivalent(comparableDefinition, serialized);
  const capabilitiesSafe = audienceCapabilitiesAreSafe(capabilities);
  const effectiveCapabilitiesUnavailable = capabilitiesUnavailable || !capabilitiesSafe;
  const saveDisabled = !owner || effectiveCapabilitiesUnavailable || pending || unchanged;

  useEffect(() => {
    const previous = previousCanonical.current;
    const sameAudience = previous.audienceIdentity === audienceIdentity;
    const sameDefinition = areAdsMutationPayloadsEquivalent(previous.definition, definition);
    previousCanonical.current = { audienceIdentity, definition };
    if (editing && exists && sameAudience && sameDefinition) return;
    setForm(createAudienceFormState(definition, suggestedTimezone, capabilities));
    setFieldErrors({});
    setEditing(!exists);
  }, [audienceIdentity, capabilities, definition, editing, exists, suggestedTimezone]);

  function updateForm(update: (current: AudienceFormState) => AudienceFormState) {
    setForm((current) => update(current));
    setFieldErrors({});
  }

  function startEditing() {
    setForm(createAudienceFormState(definition, suggestedTimezone, capabilities));
    setFieldErrors({});
    setEditing(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saveDisabled) return;
    const validation = validateAudienceForm(form, capabilities);
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
      <AudienceSummaryItem label="Audience" primary={formatAudienceAgeRange(definition)} />
      <div className="audience-summary-item"><span>Schedule</span>{schedule.map((item, index) => <div key={`${item.primary}-${item.secondary ?? index}`}><strong>{item.primary}</strong>{item.secondary && <small>{item.secondary}</small>}</div>)}</div>
      <AudienceSummaryItem label="Frequency" primary={formatAudienceFrequency(definition.frequency)} />
      <AudienceSummaryItem label="Location" primary={definition.geographies.map((item) => item.country_code).join(", ") || "Not used"} />
      <AudienceSummaryItem label="Language" primary={definition.languages.map((item) => item.tag).join(", ") || "Not used"} />
      <AudienceSummaryItem label="Interests" primary={definition.interests?.map((item) => item.slug).join(", ") || "Not used"} />
    </div>}

    {editing && <form className="audience-editor" aria-busy={pending} onSubmit={submit} noValidate>
      <fieldset className="audience-section">
        <legend>Who can see this ad?</legend>
        <div className="audience-age-range" aria-label="Audience age range">
          <label>Minimum age
            <input type="number" min={capabilities?.audienceMinimumAge ?? 13} max={capabilities?.audienceMaximumAge ?? 120} value={form.minimumAge} aria-invalid={Boolean(fieldErrors.minimumAge)} aria-describedby={fieldErrors.minimumAge ? "audience-minimum-age-error" : undefined} onChange={(event) => updateForm((current) => ({ ...current, minimumAge: event.target.value }))} />
            {fieldErrors.minimumAge && <span id="audience-minimum-age-error" className="field-error" role="alert">{fieldErrors.minimumAge}</span>}
          </label>
          <label>Maximum age
            <input type="number" min={form.minimumAge || capabilities?.audienceMinimumAge || 13} max={capabilities?.audienceMaximumAge ?? 120} value={form.maximumAge} disabled={form.noUpperAgeLimit} aria-invalid={Boolean(fieldErrors.maximumAge)} aria-describedby={fieldErrors.maximumAge ? "audience-maximum-age-error" : undefined} onChange={(event) => updateForm((current) => ({ ...current, maximumAge: event.target.value }))} />
            {fieldErrors.maximumAge && <span id="audience-maximum-age-error" className="field-error" role="alert">{fieldErrors.maximumAge}</span>}
          </label>
          <label className="audience-age-open"><input type="checkbox" checked={form.noUpperAgeLimit} onChange={(event) => updateForm((current) => ({ ...current, noUpperAgeLimit: event.target.checked, maximumAge: event.target.checked ? "" : current.maximumAge || String(capabilities?.audienceMaximumAge ?? 120) }))} />No upper age limit</label>
          <p>Allowed range: {capabilities?.audienceMinimumAge ?? 13}–{capabilities?.audienceMaximumAge ?? 120}. Viewer age is verified by the server.</p>
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
        {capabilities?.policyVersion === "nelyon-ads-targeting-v4" && <div className="audience-personalization-targeting">
          <label>Broad content countries
            <input value={form.countryCodes} placeholder="US, MX" aria-invalid={Boolean(fieldErrors.countryCodes)} onChange={(event) => updateForm((current) => ({ ...current, countryCodes: event.target.value }))} />
            <small>Two-letter broad country codes only. Precise location is never used.</small>
            {fieldErrors.countryCodes && <span className="field-error" role="alert">{fieldErrors.countryCodes}</span>}
          </label>
          <label>Content languages
            <input value={form.languageTags} placeholder="es, en" aria-invalid={Boolean(fieldErrors.languageTags)} onChange={(event) => updateForm((current) => ({ ...current, languageTags: event.target.value }))} />
            {fieldErrors.languageTags && <span className="field-error" role="alert">{fieldErrors.languageTags}</span>}
          </label>
          <fieldset><legend>Safe interests</legend>
            <div className="audience-interest-grid">{capabilities.interestCatalog?.map((interest) => <label key={interest.slug}>
              <input type="checkbox" checked={form.interestSlugs.includes(interest.slug)} onChange={(event) => updateForm((current) => ({ ...current, interestSlugs: event.target.checked ? [...current.interestSlugs, interest.slug] : current.interestSlugs.filter((slug) => slug !== interest.slug) }))} />
              {interest.label}
            </label>)}</div>
            {fieldErrors.interestSlugs && <span className="field-error" role="alert">{fieldErrors.interestSlugs}</span>}
          </fieldset>
          <p>Personalized matching is adult-only and requires the viewer’s consent. Advertisers never receive private behavior or embeddings.</p>
        </div>}
        <div className="audience-capability-grid">{capabilityLabels.filter(([key]) => !(capabilities?.policyVersion === "nelyon-ads-targeting-v4" && ["geoTargetingEnabled", "languageTargetingEnabled", "interestTargetingEnabled", "behavioralTargetingEnabled"].includes(key))).map(([key, label]) => <article key={key}><h3>{label}</h3><strong>Not available yet</strong></article>)}</div>
        <p className="audience-privacy-note">Nelyon does not use sensitive targeting or precise viewer location for this audience.</p>
      </fieldset>

      {unchanged && <p className="muted-copy" role="status">No changes to save.</p>}
      <div className="compact-actions"><button className="primary-button" disabled={saveDisabled} type="submit">{pending ? "Saving…" : exists ? "Save changes" : "Create audience"}</button>{exists && <button className="secondary-button" type="button" disabled={pending} onClick={() => { setForm(createAudienceFormState(definition, suggestedTimezone, capabilities)); setFieldErrors({}); setEditing(false); }}>Cancel editing</button>}</div>
    </form>}
  </section>;
}

function AudienceSummaryItem({ label, primary }: { label: string; primary: string }) {
  return <div className="audience-summary-item"><span>{label}</span><strong>{primary}</strong></div>;
}
