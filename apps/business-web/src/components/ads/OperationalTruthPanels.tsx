import { useMemo, useState } from "react";
import { FormField, InlineError, StatusBadge } from "../BusinessUI";
import type { AdvertisingCampaignReadiness, AdvertisingFinance } from "../../lib/adsManagerApi";
import type { AdsWorkflowStep } from "../../lib/adsWorkflowState";
import {
  ADS_OPERATIONAL_RUNTIME,
  deriveLifecyclePresentation,
  deriveReadinessPresentation,
  deriveWorkflowSetupActions,
  metricPresentation,
  validateBudgetDecimal,
  type MetricKey,
  type MetricPresentation,
} from "../../lib/adsOperationalTruth";

type CampaignShape = {
  id: string;
  name: string;
  status: string;
  lifecycle?: { activationEnabled: boolean; automaticTransitionsEnabled: boolean; requiresFinancialSettlement: boolean };
};

type LifecycleAction = "activate" | "pause" | "resume" | "cancel";

type Props = {
  campaign: CampaignShape;
  readiness: AdvertisingCampaignReadiness;
  workflowSteps: AdsWorkflowStep[];
  finance: AdvertisingFinance | null;
  analytics: Record<string, unknown>;
  owner: boolean;
  pending: boolean;
  onCreateBudget: (budgetBdag: string) => Promise<boolean>;
  onLifecycle: (action: LifecycleAction) => Promise<boolean>;
};

const statusLabels: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  needs_attention: "Needs attention",
  blocked: "Blocked",
};

const financeLabels: Record<string, string> = { draft: "Budget saved", funded: "Funded", settled: "Settled" };

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatBdag(value: string | number) {
  const numeric = Number(value);
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(numeric)} BDAG`;
}

function TruthMetric({ label, presentation }: { label: string; presentation: MetricPresentation }) {
  return <article className={`ads-metric-card ads-metric-${presentation.state}`} aria-label={`${label} metric`}>
    <span>{label}</span>
    <strong>{presentation.display}</strong>
    {presentation.detail && <small>{presentation.detail}</small>}
  </article>;
}

function analyticsPresentation(metric: MetricKey, analytics: Record<string, unknown>, impressions: number) {
  return metricPresentation(metric, analytics[metric], ADS_OPERATIONAL_RUNTIME, { impressions });
}

function BudgetPanel({ finance, owner, pending, onCreateBudget }: Pick<Props, "finance" | "owner" | "pending" | "onCreateBudget">) {
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const validation = validateBudgetDecimal(budget);
    if (!validation.valid) { setError(validation.error); return; }
    setError(null);
    await onCreateBudget(validation.canonical);
  }

  return <section id="budget" className="business-card editor-card ads-operational-panel">
    <p className="eyebrow">Step 9</p>
    <h2>Campaign budget</h2>
    {finance ? <>
      <div className="panel-title"><div><strong>{financeLabels[finance.financeStatus] ?? "Budget saved"}</strong><p>This is the canonical campaign finance state.</p></div><StatusBadge status={finance.financeStatus} /></div>
      <div className="ads-summary-grid">
        <TruthMetric label="Budget" presentation={{ state: "measured", display: formatBdag(finance.budgetBdag), detail: null }} />
        <TruthMetric label="Funded" presentation={{ state: "measured", display: formatBdag(finance.fundedBdag), detail: null }} />
        <TruthMetric label="Spent" presentation={{ state: "measured", display: formatBdag(finance.spentBdag), detail: null }} />
        <TruthMetric label="Remaining reserved budget" presentation={{ state: "measured", display: formatBdag(finance.reservedBdag), detail: null }} />
        <TruthMetric label="Returned" presentation={{ state: "measured", display: formatBdag(finance.releasedBdag), detail: null }} />
      </div>
      <p className="readonly-note">This budget is saved and can't be changed in the current pre-launch flow.</p>
    </> : <>
      <p>No budget has been set yet.</p>
      <form className="seller-form ads-budget-form" aria-busy={pending} onSubmit={(event) => void submit(event)} noValidate>
        <FormField label="Campaign budget" hint="Enter a positive BDAG amount with up to 8 decimal places.">
          <div className="ads-budget-input"><input aria-label="Campaign budget" aria-describedby="campaign-budget-error campaign-budget-currency" aria-invalid={Boolean(error)} inputMode="decimal" autoComplete="off" value={budget} onChange={(event) => { setBudget(event.target.value); setError(null); }} /><span id="campaign-budget-currency">BDAG</span></div>
        </FormField>
        <div id="campaign-budget-error"><InlineError message={error} /></div>
        <button className="primary-button" disabled={!owner || pending} type="submit" aria-busy={pending}>{pending ? "Saving…" : "Set budget"}</button>
      </form>
    </>}
    <div className="readonly-note"><strong>Funding is not available during the current pre-launch phase.</strong><span>You can save a budget now. No money moves until platform funding is available.</span></div>
    <div className="readonly-note"><strong>Ad billing is not active during pre-launch.</strong><span>Current impressions and interactions do not consume this budget.</span></div>
  </section>;
}

function ReadinessGroup({ title, items }: { title: string; items: Array<{ message: string; action: { label: string; href: string } | null }> }) {
  if (items.length === 0) return null;
  return <section className="ads-readiness-group"><h3>{title}</h3><ul>{items.map((item, index) => <li key={`${item.message}:${index}`}><span>{item.message}</span>{item.action && <a className="text-button" href={item.action.href}>{item.action.label}</a>}</li>)}</ul></section>;
}

function ReadinessPanel({ campaign, readiness, workflowSteps, finance, owner, pending, onLifecycle }: Omit<Props, "analytics" | "onCreateBudget">) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const fundingEnabled = finance?.policy.fundingEnabled ?? ADS_OPERATIONAL_RUNTIME.fundingEnabled;
  const presentation = useMemo(() => deriveReadinessPresentation(readiness.blockers, { fundingEnabled }), [fundingEnabled, readiness.blockers]);
  const lifecycle = deriveLifecyclePresentation(campaign.status, readiness);
  const workflowActions = deriveWorkflowSetupActions(workflowSteps);
  const actionItems = [...workflowActions.map((action) => ({ message: action.label, action })), ...presentation.user]
    .filter((item, index, rows) => rows.findIndex((other) => other.action?.label === item.action?.label && other.action?.href === item.action?.href) === index);
  const platformItems = [...presentation.platform];
  if (!fundingEnabled && !platformItems.some((item) => item.code === "campaign_finance_not_funded")) platformItems.unshift({ code: "finance_funding_disabled", category: "platform" as const, message: "Campaign funding is not available during the current pre-launch phase.", action: null });
  if (!readiness.activationEnabled) platformItems.push({ code: "campaign_activation_disabled", category: "platform" as const, message: "Campaign activation is not available during pre-launch.", action: null });

  async function lifecycleAction(action: LifecycleAction) {
    const saved = await onLifecycle(action);
    if (saved && action === "cancel") setConfirmCancel(false);
  }

  return <section id="readiness" className="business-card editor-card ads-operational-panel">
    <p className="eyebrow">Step 10</p>
    <h2>Campaign readiness</h2>
    <div className="ads-readiness-overall" role="status"><strong>{readiness.structurallyReady ? "Setup complete" : "Not ready yet"}</strong><span>{readiness.structurallyReady && readiness.targetStatus === "active" ? "The campaign would start immediately when activation is available." : readiness.structurallyReady && readiness.targetStatus === "scheduled" ? "The campaign is scheduled for later." : "Complete the available setup actions while Nelyon keeps platform launch controls locked."}</span></div>
    <section className="ads-readiness-group"><h3>Setup progress</h3><ul className="ads-v2-checklist">{workflowSteps.filter((step) => step.key !== "readiness").map((step) => <li key={step.key} className={step.status === "complete" ? "is-ready" : ""}><span aria-hidden="true">{step.status === "complete" ? "✓" : "○"}</span><strong>{step.label}</strong><small>{statusLabels[step.status] ?? "Needs attention"}</small></li>)}</ul></section>
    <ReadinessGroup title="Actions you can take" items={actionItems} />
    <ReadinessGroup title="Account attention" items={presentation.account} />
    <ReadinessGroup title="Platform status" items={platformItems} />
    <section className="ads-readiness-group"><h3>Campaign lifecycle</h3><p>Current status: <StatusBadge status={campaign.status} /></p>{lifecycle.pause.visible && <p>Pausing holds campaign delivery until the campaign is resumed.</p>}<div className="compact-actions">
      {lifecycle.activate.visible && <button type="button" disabled={!owner || !lifecycle.activate.enabled || pending} onClick={() => void lifecycleAction("activate")}>{pending ? "Saving…" : readiness.activationEnabled ? "Activate campaign" : "Activation locked"}</button>}
      {lifecycle.pause.visible && <button type="button" disabled={!owner || pending} onClick={() => void lifecycleAction("pause")}>{pending ? "Saving…" : "Pause campaign"}</button>}
      {lifecycle.resume.visible && <button type="button" disabled={!owner || !lifecycle.resume.enabled || pending} onClick={() => void lifecycleAction("resume")}>{pending ? "Saving…" : "Resume campaign"}</button>}
      {lifecycle.cancel.visible && <button className="danger-button" type="button" disabled={!owner || pending} onClick={() => setConfirmCancel(true)}>Cancel campaign</button>}
    </div></section>
    {campaign.lifecycle?.requiresFinancialSettlement && <p className="readonly-note">Unused funded budget is returned by the platform during settlement. Settlement is not a customer action.</p>}
    {confirmCancel && <div className="media-dialog-backdrop" onMouseDown={() => { if (!pending) setConfirmCancel(false); }}><section className="media-dialog ads-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-campaign-title" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">Campaign lifecycle</p><h3 id="cancel-campaign-title">Cancel {campaign.name}?</h3><p>This campaign will be cancelled and cannot be resumed.</p><div className="compact-actions"><button className="secondary-button" type="button" disabled={pending} onClick={() => setConfirmCancel(false)}>Keep campaign</button><button className="danger-button" type="button" aria-busy={pending} disabled={pending} onClick={() => void lifecycleAction("cancel")}>{pending ? "Cancelling…" : "Confirm cancellation"}</button></div></section></div>}
  </section>;
}

function AnalyticsPanel({ analytics, finance }: Pick<Props, "analytics" | "finance">) {
  const impressions = numberValue(analytics.impressions);
  const metrics: Array<[string, MetricKey]> = [
    ["Impressions", "impressions"], ["Clicks", "clicks"], ["Destination opens", "destination_opens"],
    ["Video views", "video_views"], ["Engagements", "engagements"], ["CTR", "ctr"],
    ["Conversions", "conversions"], ["Attributed conversions", "attributed_conversions"],
    ["Marketplace purchase value", "marketplace_purchase_value_bdag"], ["CPC", "cpc"], ["CPM", "cpm"], ["CPA", "cpa"],
  ];
  const spend: MetricPresentation = { state: "platform_disabled", display: finance ? formatBdag(finance.spentBdag) : "No campaign finance", detail: "Ad billing is not active during pre-launch." };
  return <section className="business-card editor-card ads-operational-panel" aria-labelledby="campaign-analytics-title"><p className="eyebrow">Measured performance</p><h2 id="campaign-analytics-title">Analytics</h2>{impressions === 0 && <div className="readonly-note"><strong>No ad delivery has occurred yet.</strong><span>Delivery is currently unavailable during pre-launch.</span></div>}<div className="ads-summary-grid">{metrics.map(([label, metric]) => <TruthMetric key={metric} label={label} presentation={analyticsPresentation(metric, analytics, impressions)} />)}<TruthMetric label="Spend" presentation={spend} /></div></section>;
}

export function OperationalTruthPanels(props: Props) {
  return <>
    <BudgetPanel finance={props.finance} owner={props.owner} pending={props.pending} onCreateBudget={props.onCreateBudget} />
    <ReadinessPanel campaign={props.campaign} readiness={props.readiness} workflowSteps={props.workflowSteps} finance={props.finance} owner={props.owner} pending={props.pending} onLifecycle={props.onLifecycle} />
    <AnalyticsPanel analytics={props.analytics} finance={props.finance} />
  </>;
}
