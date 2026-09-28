import { useMemo, useState } from "react";
import { FormField, InlineError, StatusBadge } from "../BusinessUI";
import { BusinessConfirmDialog } from "../BusinessConfirmDialog";
import type { AdvertisingCampaignBilling, AdvertisingCampaignReadiness, AdvertisingFinance } from "../../lib/adsManagerApi";
import type { AdsWorkflowStep } from "../../lib/adsWorkflowState";
import {
  businessMetricPresentation,
  businessServerMetricPresentation,
  deriveBusinessAdsRuntime,
  deriveBusinessReadinessPresentation,
  deriveBusinessStatusSummary,
  deriveLifecyclePresentation,
  deriveWorkflowSetupActions,
  validateBudgetDecimal,
  type BusinessAdsRuntime,
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
  billing: AdvertisingCampaignBilling | null;
  analytics: Record<string, unknown> | null;
  analyticsError: string | null;
  deliveryEnabled: boolean;
  owner: boolean;
  lifecycleOwner: boolean;
  pending: boolean;
  onRetry: () => Promise<void>;
  onCreateBudget: (budgetBdag: string) => Promise<boolean>;
  onFundBudget: () => Promise<boolean>;
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

function analyticsPresentation(metric: MetricKey, analytics: Record<string, unknown>, impressions: number, runtime: BusinessAdsRuntime) {
  if (metric === "objective_results") {
    const rawStatus = analytics.objective_result_status;
    const status = rawStatus === "available" || rawStatus === "not_applicable" ? rawStatus : "no_data";
    return businessServerMetricPresentation(analytics.objective_results, status);
  }
  return businessMetricPresentation(metric, analytics[metric], runtime, { impressions });
}

function BudgetPanel({ campaign, finance, billing, owner, pending, onCreateBudget, onFundBudget }: Pick<Props, "campaign" | "finance" | "billing" | "owner" | "pending" | "onCreateBudget" | "onFundBudget">) {
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmFunding, setConfirmFunding] = useState(false);
  const placementRates = billing?.placementRates ?? [];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const validation = validateBudgetDecimal(budget);
    if (!validation.valid) { setError(validation.error); return; }
    setError(null);
    await onCreateBudget(validation.canonical);
  }

  async function fund() {
    try { await onFundBudget(); }
    finally { setConfirmFunding(false); }
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
        {billing && <TruthMetric label="Pending billing reservation" presentation={{ state: "measured", display: formatBdag(billing.pendingReservedBdag), detail: "Only active OPEN-window reservations are included." }} />}
        {billing && <TruthMetric label="Available to reserve" presentation={{ state: billing.reservationConsistent ? "measured" : "platform_disabled", display: formatBdag(billing.availableToReserveBdag), detail: billing.anomalyCode }} />}
      </div>
      <p className="readonly-note">This is the canonical saved budget. Finance state changes only through the available server-backed controls.</p>
      {finance.financeStatus === "draft" && finance.fundingAvailable && <>
        <button className="primary-button" type="button" disabled={!owner || pending} aria-busy={pending} onClick={() => setConfirmFunding(true)}>{pending ? "Funding…" : "Fund budget"}</button>
        <BusinessConfirmDialog
          open={confirmFunding}
          title={`Fund ${campaign.name}?`}
          description={`Funding ${finance.budgetBdagExact} BDAG will move that amount from your BDAG balance into Ads escrow for this Campaign.`}
          confirmLabel="Confirm funding"
          cancelLabel="Keep budget draft"
          pendingLabel="Funding…"
          pending={pending}
          onCancel={() => setConfirmFunding(false)}
          onConfirm={() => void fund()}
        />
      </>}
      {finance.financeStatus === "draft" && !finance.fundingAvailable && finance.fundingState === "campaign_restricted" && <div className="readonly-note"><strong>Funding is not currently available for this Campaign.</strong><span>The saved budget remains unchanged.</span></div>}
      {finance.financeStatus === "draft" && !finance.fundingAvailable && finance.fundingState !== "campaign_restricted" && <div className="readonly-note"><strong>Platform Funding is currently unavailable.</strong><span>Your saved budget remains unchanged. No money moves while Funding is unavailable.</span></div>}
    </> : <>
      <p>No budget has been set yet.</p>
      <form className="seller-form ads-budget-form" aria-busy={pending} onSubmit={(event) => void submit(event)} noValidate>
        <FormField label="Campaign budget" hint="Enter a positive BDAG amount with up to 8 decimal places.">
          <div className="ads-budget-input"><input aria-label="Campaign budget" aria-describedby="campaign-budget-error campaign-budget-currency" aria-invalid={Boolean(error)} inputMode="decimal" autoComplete="off" value={budget} onChange={(event) => { setBudget(event.target.value); setError(null); }} /><span id="campaign-budget-currency">BDAG</span></div>
        </FormField>
        <div id="campaign-budget-error"><InlineError message={error} /></div>
        <button className="primary-button" disabled={!owner || pending} type="submit" aria-busy={pending}>{pending ? "Saving…" : "Set budget"}</button>
      </form>
      <div className="readonly-note"><strong>Set a budget to check Funding availability.</strong><span>No money moves when a budget draft is saved.</span></div>
    </>}
    {billing && <div className="readonly-note"><strong>{billing.rateStatus === "available" ? `Billing basis: ${billing.billingBasis?.replaceAll("_", " ")}` : "Billing rate coverage is not complete."}</strong><span>{billing.rateStatus === "available" ? `${billing.coveredPlacementCount ?? placementRates.filter((rate) => rate.rateStatus === "available").length}/${billing.selectedPlacementCount ?? placementRates.length} selected placements have a canonical published rate. Charges are calculated only by the server.` : "This Campaign is not billing-launch-ready until every selected placement has an applicable published rate."}</span></div>}
    {placementRates.length > 0 && <div className="readonly-note"><strong>Rates by placement</strong><ul>{placementRates.map((rate) => <li key={rate.placementCode}><span>{rate.placementCode.replaceAll("_", " ")}: {rate.rateStatus === "available" && rate.rateBdag != null ? `${formatBdag(rate.rateBdag)} / ${rate.billableEventType}` : "Rate unavailable"}</span></li>)}</ul></div>}
  </section>;
}

function ReadinessGroup({ title, items }: { title: string; items: Array<{ message: string; action: { label: string; href: string } | null }> }) {
  if (items.length === 0) return null;
  return <section className="ads-readiness-group"><h3>{title}</h3><ul>{items.map((item, index) => <li key={`${item.message}:${index}`}><span>{item.message}</span>{item.action && <a className="text-button" href={item.action.href}>{item.action.label}</a>}</li>)}</ul></section>;
}

function ReadinessPanel({ campaign, readiness, workflowSteps, finance, lifecycleOwner, pending, onLifecycle }: Omit<Props, "analytics" | "analyticsError" | "billing" | "deliveryEnabled" | "owner" | "onRetry" | "onCreateBudget" | "onFundBudget">) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const fundingAvailable = finance?.fundingAvailable ?? false;
  const presentation = useMemo(() => deriveBusinessReadinessPresentation(readiness.blockers, { fundingAvailable }), [fundingAvailable, readiness.blockers]);
  const lifecycle = deriveLifecyclePresentation(campaign.status, readiness);
  const statusSummary = deriveBusinessStatusSummary({ status: campaign.status, structurallyReady: readiness.structurallyReady, activationEnabled: readiness.activationEnabled, financeReady: readiness.financeReady });
  const workflowActions = deriveWorkflowSetupActions(workflowSteps);
  const actionItems = [...workflowActions.map((action) => ({ message: action.label, action })), ...presentation.user]
    .filter((item, index, rows) => rows.findIndex((other) => other.action?.label === item.action?.label && other.action?.href === item.action?.href) === index);
  const platformItems = [...presentation.platform];
  if (campaign.status === "draft" && finance?.financeStatus === "draft" && !fundingAvailable && !platformItems.some((item) => item.code === "campaign_finance_not_funded")) platformItems.unshift({ code: "finance_funding_disabled", category: "platform" as const, message: "Campaign funding is currently unavailable.", action: null });
  if (["draft", "paused"].includes(campaign.status) && !readiness.activationEnabled) platformItems.push({ code: "campaign_activation_disabled", category: "platform" as const, message: "Campaign activation is currently unavailable.", action: null });

  async function lifecycleAction(action: LifecycleAction) {
    const saved = await onLifecycle(action);
    if (saved && action === "cancel") setConfirmCancel(false);
  }

  return <section id="readiness" className="business-card editor-card ads-operational-panel">
    <p className="eyebrow">Step 10</p>
    <h2>Campaign readiness</h2>
    <div className="ads-readiness-overall" role="status"><strong>{statusSummary.title}</strong><span>{statusSummary.detail}</span></div>
    <section className="ads-readiness-group"><h3>Setup progress</h3><ul className="ads-v2-checklist">{workflowSteps.filter((step) => step.key !== "readiness").map((step) => <li key={step.key} className={step.status === "complete" ? "is-ready" : ""}><span aria-hidden="true">{step.status === "complete" ? "✓" : "○"}</span><strong>{step.label}</strong>{" "}<small>{statusLabels[step.status] ?? "Needs attention"}</small></li>)}</ul></section>
    <ReadinessGroup title="Actions you can take" items={actionItems} />
    <ReadinessGroup title="Account attention" items={presentation.account} />
    <ReadinessGroup title="Platform status" items={platformItems} />
    <section className="ads-readiness-group"><h3>Campaign lifecycle</h3><p>Current status: <StatusBadge status={campaign.status} /></p>{lifecycle.pause.visible && <p>Pausing holds campaign delivery until the campaign is resumed.</p>}<div className="compact-actions">
      {lifecycle.activate.visible && <button type="button" disabled={!lifecycleOwner || !lifecycle.activate.enabled || pending} onClick={() => void lifecycleAction("activate")}>{pending ? "Saving…" : readiness.activationEnabled ? "Activate campaign" : "Activation locked"}</button>}
      {lifecycle.pause.visible && <button type="button" disabled={!lifecycleOwner || pending} onClick={() => void lifecycleAction("pause")}>{pending ? "Saving…" : "Pause campaign"}</button>}
      {lifecycle.resume.visible && <button type="button" disabled={!lifecycleOwner || !lifecycle.resume.enabled || pending} onClick={() => void lifecycleAction("resume")}>{pending ? "Saving…" : "Resume campaign"}</button>}
      {lifecycle.cancel.visible && <button className="danger-button" type="button" disabled={!lifecycleOwner || pending} onClick={() => setConfirmCancel(true)}>Cancel campaign</button>}
    </div></section>
    {campaign.lifecycle?.requiresFinancialSettlement && <p className="readonly-note">Unused funded budget is returned by the platform during settlement. Settlement is not a customer action.</p>}
    <BusinessConfirmDialog open={confirmCancel} title={`Cancel ${campaign.name}?`} description="This campaign will be cancelled and cannot be resumed." confirmLabel="Confirm cancellation" cancelLabel="Keep campaign" pendingLabel="Cancelling…" pending={pending} danger onCancel={() => setConfirmCancel(false)} onConfirm={() => void lifecycleAction("cancel")} />
  </section>;
}

function AnalyticsPanel({ analytics, analyticsError, finance, billing, deliveryEnabled, onRetry }: Pick<Props, "analytics" | "analyticsError" | "finance" | "billing" | "deliveryEnabled" | "onRetry">) {
  if (!analytics) return <section className="business-card editor-card ads-operational-panel" aria-labelledby="campaign-analytics-title"><p className="eyebrow">Measured performance</p><h2 id="campaign-analytics-title">Analytics</h2><InlineError message={analyticsError ?? "Campaign analytics are temporarily unavailable."} onRetry={() => void onRetry()} /></section>;
  const impressions = numberValue(analytics.impressions);
  const metrics: Array<[string, MetricKey]> = [
    ["Impressions", "impressions"], ["Unique reach", "unique_reach"], ["Clicks", "clicks"], ["Destination opens", "destination_opens"],
    ["Video views", "video_views"], ["Engagements", "engagements"], ["Profile visits", "profile_visits"],
    ["Message starts", "message_starts"], ["App-store opens", "app_store_opens"], ["Objective results", "objective_results"],
    ["Conversions", "conversions"], ["Attributed purchases", "attributed_conversions"],
    ["Attributed purchase value (GMV)", "marketplace_purchase_value_bdag"],
  ];
  const runtime = deriveBusinessAdsRuntime({ deliveryEnabled, fundingEnabled: finance?.policy.fundingEnabled ?? false, spendEnabled: finance?.policy.spendEnabled ?? false });
  const spend: MetricPresentation = runtime.billingRuntime
    ? { state: "measured", display: finance ? formatBdag(finance.spentBdag) : "No campaign finance", detail: null }
    : { state: "platform_disabled", display: finance ? formatBdag(finance.spentBdag) : "No campaign finance", detail: "Ad billing is currently unavailable." };
  const status = (key: string) => analytics[key] === "available" || analytics[key] === "not_applicable" ? analytics[key] as "available" | "not_applicable" : "no_data";
  const ctr = businessServerMetricPresentation(analytics.ctr, status("ctr_status"));
  const cpc = businessServerMetricPresentation(analytics.cpc_bdag, status("cpc_status"), { suffix: " BDAG" });
  const cpm = businessServerMetricPresentation(analytics.cpm_bdag, status("cpm_status"), { suffix: " BDAG" });
  const conversionRate = businessServerMetricPresentation(analytics.conversion_rate, status("conversion_rate_status"));
  const roas = businessServerMetricPresentation(analytics.roas, status("roas_status"), { suffix: "×" });
  return <section className="business-card editor-card ads-operational-panel" aria-labelledby="campaign-analytics-title"><p className="eyebrow">Measured performance</p><h2 id="campaign-analytics-title">Analytics</h2>{analyticsError && <><div className="readonly-note" role="status">Showing the last loaded analytics.</div><InlineError message={analyticsError} onRetry={() => void onRetry()} /></>}{impressions === 0 && <div className="readonly-note"><strong>No ad delivery has occurred yet.</strong><span>{deliveryEnabled ? "Delivery is available; this campaign has not delivered yet." : "Ad delivery is currently unavailable."}</span></div>}<div className="ads-summary-grid">{metrics.map(([label, metric]) => <TruthMetric key={metric} label={label} presentation={analyticsPresentation(metric, analytics, impressions, runtime)} />)}<TruthMetric label="CTR" presentation={ctr} /><TruthMetric label="CPC" presentation={cpc} /><TruthMetric label="CPM" presentation={cpm} /><TruthMetric label="Conversion rate" presentation={conversionRate} /><TruthMetric label="ROAS" presentation={roas} /><TruthMetric label="Spend" presentation={spend} /></div>{billing?.anomalyCode && <div className="readonly-note" role="alert"><strong>Billing is blocked safely.</strong><span>{billing.anomalyCode}</span></div>}</section>;
}

export function OperationalTruthPanels(props: Props) {
  return <>
    <BudgetPanel campaign={props.campaign} finance={props.finance} billing={props.billing} owner={props.owner} pending={props.pending} onCreateBudget={props.onCreateBudget} onFundBudget={props.onFundBudget} />
    <ReadinessPanel campaign={props.campaign} readiness={props.readiness} workflowSteps={props.workflowSteps} finance={props.finance} lifecycleOwner={props.lifecycleOwner} pending={props.pending} onLifecycle={props.onLifecycle} />
    <AnalyticsPanel analytics={props.analytics} analyticsError={props.analyticsError} finance={props.finance} billing={props.billing} deliveryEnabled={props.deliveryEnabled} onRetry={props.onRetry} />
  </>;
}
