import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import {
  activateAdCampaign,
  getAdCampaign,
  pauseAdCampaign,
  resumeAdCampaign,
  type AdCampaignDetail,
} from "../../lib/adsManagerApi";
import { formatDate, formatMoney } from "../../lib/businessFormat";

function ctr(clicks: number, impressions: number) {
  return impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : "—";
}
export function BusinessAdDetailPage() {
  const { campaignId = "" } = useParams();
  const { currentBusiness, accessType, hasCapability } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const canManage = hasCapability("business.ads.manage");
  const isOwner = accessType === "owner";
  const [campaign, setCampaign] = useState<AdCampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestKey = useRef("");
  requestKey.current = `${ownerId}:${campaignId}`;

  const load = useCallback(async () => {
    if (!ownerId || !campaignId) return;
    const expected = `${ownerId}:${campaignId}`;
    setLoading(true); setError(null);
    try {
      const value = await getAdCampaign(ownerId, campaignId);
      if (requestKey.current === expected) setCampaign(value);
    } catch (cause) {
      if (requestKey.current === expected) setError(cause instanceof Error ? cause.message : "No se pudo cargar la campaña");
    } finally {
      if (requestKey.current === expected) setLoading(false);
    }
  }, [campaignId, ownerId]);

  useEffect(() => { setCampaign(null); setSuccess(null); void load(); }, [load]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setWorking(true); setError(null); setSuccess(null);
    try { await action(); setSuccess(successMessage); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción"); }
    finally { setWorking(false); }
  }

  function activate() {
    if (!campaign || !isOwner) return;
    const confirmed = window.confirm(`Activar y financiar “${campaign.name ?? campaign.product.title}”\n\nProducto: ${campaign.product.title}\nPresupuesto: ${formatMoney(campaign.totalBudgetBdag)}\nProgramación: ${formatDate(campaign.startsAt)} — ${formatDate(campaign.endsAt)}\n\nLa activación reservará el presupuesto BDAG en Ads escrow.`);
    if (confirmed) void run(() => activateAdCampaign(campaign.id), "Campaña activada y financiada");
  }

  return <>
    <PageHeader eyebrow="Ads Manager" title={campaign?.name ?? campaign?.product.title ?? "Detalle de campaña"} description="Rendimiento, atribución y presupuesto sobre las authorities canónicas." action={<Link className="text-button" to="/ads">Volver a campañas</Link>} />
    <InlineError message={error} />
    {success && <div className="inline-success" role="status">{success}</div>}
    {loading && <div className="seller-state">Cargando campaña…</div>}
    {!loading && campaign && <>
      <section className="ads-detail-hero business-card">
        <div className="ads-detail-product">{campaign.product.imageUrl ? <img src={campaign.product.imageUrl} alt="" /> : <span className="product-placeholder">◎</span>}<div><p className="eyebrow">Producto promocionado</p><h2>{campaign.product.title}</h2><span>{formatMoney(campaign.product.price, campaign.product.currency)}</span></div></div>
        <div className="ads-detail-status"><StatusBadge status={campaign.status} /><small>{formatDate(campaign.startsAt)} — {formatDate(campaign.endsAt)}</small><span>{campaign.eligibilityState ? "Elegible para delivery" : `Delivery detenido: ${campaign.eligibilityReason ?? "sin elegibilidad"}`}</span></div>
        <div className="header-actions">
          {campaign.status === "draft" && isOwner && <button className="primary-button" type="button" disabled={working} onClick={activate}>{working ? "Procesando…" : "Activar y financiar"}</button>}
          {campaign.status === "draft" && !isOwner && <span className="readonly-note">La activación y financiación requieren al propietario.</span>}
          {canManage && (campaign.status === "active" || campaign.status === "scheduled") && <button className="secondary-button" type="button" disabled={working} onClick={() => void run(() => pauseAdCampaign(campaign.id), "Campaña pausada")}>Pausar</button>}
          {canManage && campaign.status === "paused" && <button className="primary-button" type="button" disabled={working} onClick={() => void run(() => resumeAdCampaign(campaign.id), "Campaña reanudada")}>Reanudar</button>}
        </div>
      </section>
      <section className="ads-detail-section"><h2>Presupuesto</h2><div className="ads-summary-grid"><Metric label="Presupuesto" value={formatMoney(campaign.totalBudgetBdag)} /><Metric label="Gastado" value={formatMoney(campaign.spentBdag)} /><Metric label="Restante reservado" value={formatMoney(campaign.remainingReservedBdag)} /><Metric label="Liberado" value={formatMoney(campaign.releasedBdag)} /></div></section>
      <section className="ads-detail-section"><h2>Performance</h2><div className="ads-summary-grid"><Metric label="Impresiones" value={campaign.impressions.toLocaleString("es")} /><Metric label="Clicks" value={campaign.clicks.toLocaleString("es")} /><Metric label="CTR" value={ctr(campaign.clicks, campaign.impressions)} /><Metric label="Vistas de producto" value={campaign.productViews.toLocaleString("es")} /><Metric label="Añadidos al carrito" value={campaign.cartAdds.toLocaleString("es")} /><Metric label="Pedidos" value={String(campaign.orders)} /><Metric label="GMV atribuido" value={formatMoney(campaign.attributedGmvBdag)} /></div></section>
      <section className="ads-detail-grid">
        <article className="business-card"><h2>Delivery</h2>{campaign.deliverySurfaces.length === 0 ? <p className="muted-copy">Aún no hay eventos de delivery.</p> : <div className="ads-surface-list">{campaign.deliverySurfaces.map((surface) => <div key={surface.surface}><strong>{surface.surface}</strong><span>{surface.impressions} impresiones · {surface.clicks} clicks · {surface.productViews} vistas · {surface.cartAdds} carritos · {surface.purchases} compras</span></div>)}</div>}</article>
        <article className="business-card"><h2>Atribución canónica</h2>{campaign.attribution.length === 0 ? <p className="muted-copy">Aún no hay pedidos atribuidos.</p> : <div className="ads-surface-list">{campaign.attribution.map((item) => <div key={`${item.orderNumber}:${item.attributedAt}`}><strong>{item.orderNumber}</strong><span>{formatMoney(item.attributedGmvBdag)} · {formatDate(item.attributedAt)}</span></div>)}</div>}</article>
      </section>
      {campaign.finalization && <section className="business-card ads-finalization"><p className="eyebrow">Finalización</p><h2>Delivery finalizado</h2><p>Finalizada el {formatDate(String(campaign.finalization.finalized_at))}. El estado financiero final es de solo lectura.</p></section>}
    </>}
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="ads-metric-card"><span>{label}</span><strong>{value}</strong></article>;
}
