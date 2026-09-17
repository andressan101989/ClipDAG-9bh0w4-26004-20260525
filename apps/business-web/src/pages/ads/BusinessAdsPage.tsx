import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import {
  searchAdCampaigns,
  type AdCampaignSummary,
  type AdsCursor,
  type AdsMetricSummary,
} from "../../lib/adsManagerApi";
import { formatDate, formatMoney } from "../../lib/businessFormat";

const STATUSES = [
  ["", "Todas"], ["draft", "Borradores"], ["scheduled", "Programadas"],
  ["active", "Activas"], ["paused", "Pausadas"], ["completed", "Completadas"],
  ["exhausted", "Agotadas"], ["cancelled", "Canceladas"],
] as const;

const emptySummary: AdsMetricSummary = {
  activeCampaigns: 0, totalBudgetBdag: 0, spentBdag: 0,
  impressions: 0, clicks: 0, orders: 0, attributedGmvBdag: 0,
};

function appendUnique(current: AdCampaignSummary[], incoming: AdCampaignSummary[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
function ctr(clicks: number, impressions: number) {
  return impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : "—";
}

export function BusinessAdsPage() {
  const { currentBusiness, hasCapability } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const canManage = hasCapability("business.ads.manage");
  const [items, setItems] = useState<AdCampaignSummary[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [status, setStatus] = useState("");
  const [cursor, setCursor] = useState<AdsCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestScope = useRef("");
  requestScope.current = `${ownerId}:${status}`;

  const load = useCallback(async (pageCursor?: AdsCursor, append = false) => {
    if (!ownerId) return;
    const expectedScope = `${ownerId}:${status}`;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const page = await searchAdCampaigns(ownerId, { status: status || undefined, cursor: pageCursor });
      if (requestScope.current !== expectedScope) return;
      setItems((current) => append ? appendUnique(current, page.items) : page.items);
      setCursor(page.nextCursor);
      setSummary(page.summary);
    } catch (cause) {
      if (requestScope.current === expectedScope) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las campañas");
    } finally {
      if (requestScope.current === expectedScope) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [ownerId, status]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setSummary(emptySummary);
    void load();
  }, [load]);

  return <>
    <PageHeader
      eyebrow="Ads Manager"
      title="Publicidad"
      description="Campañas de producto financiadas en BDAG, con delivery y atribución canónicos."
      action={canManage ? <Link className="primary-button" to="/ads/new">Crear campaña</Link> : undefined}
    />
    {!canManage && <div className="readonly-note">Vista de solo lectura. Puedes consultar campañas y rendimiento.</div>}
    <section className="ads-summary-grid" aria-label="Resumen de publicidad">
      <Metric label="Campañas activas" value={String(summary.activeCampaigns)} />
      <Metric label="Presupuesto total" value={formatMoney(summary.totalBudgetBdag)} />
      <Metric label="Gastado" value={formatMoney(summary.spentBdag)} />
      <Metric label="Impresiones" value={summary.impressions.toLocaleString("es")} />
      <Metric label="Clicks" value={summary.clicks.toLocaleString("es")} />
      <Metric label="Pedidos atribuidos" value={String(summary.orders)} />
      <Metric label="GMV atribuido" value={formatMoney(summary.attributedGmvBdag)} />
    </section>
    <section className="seller-toolbar ads-toolbar">
      <div className="filter-row" aria-label="Filtrar campañas">
        {STATUSES.map(([value, label]) => <button key={value || "all"} type="button" className={status === value ? "filter-chip is-active" : "filter-chip"} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
    </section>
    <InlineError message={error} />
    {loading && <div className="seller-state">Cargando campañas…</div>}
    {!loading && !error && items.length === 0 && <div className="seller-state"><strong>No hay campañas en esta vista</strong><p>{canManage ? "Crea un borrador para promocionar un producto elegible." : "No se encontraron campañas."}</p></div>}
    {!loading && items.length > 0 && <CampaignTable items={items} />}
    {!loading && cursor && <div className="seller-pagination"><button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void load(cursor, true)}>{loadingMore ? "Cargando…" : "Ver más"}</button></div>}
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="ads-metric-card"><span>{label}</span><strong>{value}</strong></article>;
}

function CampaignTable({ items }: { items: AdCampaignSummary[] }) {
  return <div className="seller-table-wrap"><table className="seller-table ads-table"><thead><tr><th>Campaña</th><th>Estado</th><th>Presupuesto</th><th>Gastado</th><th>Performance</th><th>Programación</th></tr></thead><tbody>{items.map((campaign) => <tr key={campaign.id}>
    <td data-label="Campaña"><Link className="product-cell" to={`/ads/${campaign.id}`}>{campaign.productImageUrl ? <img src={campaign.productImageUrl} alt="" /> : <span className="product-placeholder">◎</span>}<span><strong>{campaign.name ?? campaign.productTitle}</strong><small>{campaign.productTitle}</small></span></Link></td>
    <td data-label="Estado"><StatusBadge status={campaign.status} /></td>
    <td data-label="Presupuesto">{formatMoney(campaign.totalBudgetBdag)}<small className="table-subline">Restante {formatMoney(campaign.remainingReservedBdag)}</small></td>
    <td data-label="Gastado">{formatMoney(campaign.spentBdag)}<small className="table-subline">Liberado {formatMoney(campaign.releasedBdag)}</small></td>
    <td data-label="Performance"><strong>{campaign.impressions.toLocaleString("es")} imp.</strong><small className="table-subline">{campaign.clicks} clicks · CTR {ctr(campaign.clicks, campaign.impressions)} · {campaign.orders} pedidos</small></td>
    <td data-label="Programación">{formatDate(campaign.startsAt)}<small className="table-subline">hasta {formatDate(campaign.endsAt)}</small></td>
  </tr>)}</tbody></table></div>;
}
