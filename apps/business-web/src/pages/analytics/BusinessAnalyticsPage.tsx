import { useCallback, useEffect, useRef, useState } from "react";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { BusinessAnalyticsTrend, type TrendMetric } from "../../components/BusinessAnalyticsTrend";
import { PageHeader } from "../../components/BusinessUI";
import { formatMoney } from "../../lib/businessFormat";
import { ANALYTICS_RANGES, getBusinessAnalytics, type AnalyticsRange, type BusinessAnalytics } from "../../lib/businessAnalyticsApi";

const rangeLabels: Record<AnalyticsRange, string> = { "7d": "7D", "30d": "30D", "90d": "90D" };
const sourceLabels: Record<string, string> = {
  shop: "Tienda", search: "Búsqueda", feed: "Feed", clip: "Clip", live: "Live",
  creator: "Creator", affiliate: "Afiliado", direct: "Directo", unknown: "Desconocido",
};
const metricLabels: Record<TrendMetric, string> = { gmv: "GMV", orders: "Pedidos", units: "Unidades", productViews: "Vistas" };

function Comparison({ value }: { value: string | null }) {
  if (value === null) return <small className="analytics-comparison neutral">Sin base comparable</small>;
  const numeric = Number(value);
  const direction = numeric > 0 ? "positive" : numeric < 0 ? "negative" : "neutral";
  const prefix = numeric > 0 ? "+" : "";
  return <small className={`analytics-comparison ${direction}`}>{prefix}{numeric.toLocaleString("es", { maximumFractionDigits: 2 })}% vs. período anterior</small>;
}

function MetricCard({ label, value, comparison }: { label: string; value: string; comparison: string | null }) {
  return <article className="business-card analytics-kpi"><span>{label}</span><strong>{value}</strong><Comparison value={comparison} /></article>;
}

export function BusinessAnalyticsPage() {
  const { currentBusiness } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? null;
  const businessName = currentBusiness?.store?.name ?? currentBusiness?.seller.displayName ?? "Negocio";
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [metric, setMetric] = useState<TrendMetric>("gmv");
  const [data, setData] = useState<BusinessAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setData(null);
    setError(null);
    if (!ownerId) { setLoading(false); return; }
    setLoading(true);
    void getBusinessAnalytics(ownerId, range)
      .then((next) => { if (requestId.current === currentRequest) setData(next); })
      .catch((reason: unknown) => { if (requestId.current === currentRequest) setError(reason instanceof Error ? reason.message : "No se pudo cargar Analytics"); })
      .finally(() => { if (requestId.current === currentRequest) setLoading(false); });
    return () => { if (requestId.current === currentRequest) requestId.current += 1; };
  }, [ownerId, range, retryKey]);

  const empty = data && data.commerce.current.gmvBdag === "0" && data.commerce.current.orders === 0
    && data.commerce.current.units === 0 && data.commerce.current.productViews === 0;

  return (
    <main className="business-page analytics-page">
      <PageHeader eyebrow="Rendimiento" title="Analytics" description={businessName} action={
        <div className="analytics-range" aria-label="Rango de Analytics">
          {ANALYTICS_RANGES.map((value) => <button key={value} type="button" className={range === value ? "is-active" : ""} aria-pressed={range === value} onClick={() => setRange(value)}>{rangeLabels[value]}</button>)}
        </div>
      } />

      {loading && <section className="business-card analytics-loading" aria-busy="true"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" /></section>}
      {error && <section className="business-card analytics-error" role="alert"><strong>No pudimos cargar Analytics</strong><p>{error}</p><button className="secondary-button" type="button" onClick={retry}>Reintentar</button></section>}

      {data && <>
        <section className="analytics-kpi-grid" aria-label="Indicadores principales">
          <MetricCard label="GMV" value={formatMoney(data.commerce.current.gmvBdag)} comparison={data.commerce.comparisons.gmvPercent} />
          <MetricCard label="Pedidos" value={data.commerce.current.orders.toLocaleString("es")} comparison={data.commerce.comparisons.ordersPercent} />
          <MetricCard label="Unidades vendidas" value={data.commerce.current.units.toLocaleString("es")} comparison={data.commerce.comparisons.unitsPercent} />
          <MetricCard label="Vistas de producto" value={data.commerce.current.productViews.toLocaleString("es")} comparison={data.commerce.comparisons.productViewsPercent} />
        </section>

        {empty && <section className="business-card analytics-empty"><h2>Aún no hay actividad en este período.</h2><p>Los datos aparecerán aquí cuando tus productos reciban actividad comercial.</p></section>}

        <section className="business-card analytics-section">
          <div className="analytics-section-head"><div><p className="eyebrow">Tendencia</p><h2>Rendimiento diario</h2></div><div className="analytics-metric-tabs" aria-label="Métrica de tendencia">{(Object.keys(metricLabels) as TrendMetric[]).map((value) => <button type="button" key={value} className={metric === value ? "is-active" : ""} aria-pressed={metric === value} onClick={() => setMetric(value)}>{metricLabels[value]}</button>)}</div></div>
          <BusinessAnalyticsTrend points={data.commerce.daily} metric={metric} />
        </section>

        <section className="business-card analytics-section">
          <div className="analytics-section-head"><div><p className="eyebrow">Comercio</p><h2>Rendimiento de productos</h2></div><span>{data.commerce.products.totalCount} productos en el período</span></div>
          {data.commerce.products.items.length ? <div className="table-scroll"><table><thead><tr><th>Producto</th><th>Vistas</th><th>Pedidos</th><th>Unidades</th><th>GMV</th></tr></thead><tbody>{data.commerce.products.items.map((item, index) => <tr key={item.productId ?? `deleted-${index}`}><td><strong>{item.title}</strong></td><td>{item.views}</td><td>{item.orders}</td><td>{item.units}</td><td>{formatMoney(item.gmvBdag)}</td></tr>)}</tbody></table></div> : <p className="muted-copy">Sin productos con actividad.</p>}
        </section>

        {data.commerce.variants.items.length > 0 && <section className="business-card analytics-section"><div className="analytics-section-head"><div><p className="eyebrow">Detalle</p><h2>Variantes</h2></div></div><div className="table-scroll"><table><thead><tr><th>Variante</th><th>Vistas</th><th>Pedidos</th><th>Unidades</th><th>GMV</th></tr></thead><tbody>{data.commerce.variants.items.map((item, index) => <tr key={item.variantId ?? `variant-${index}`}><td>{item.label}</td><td>{item.views}</td><td>{item.orders}</td><td>{item.units}</td><td>{formatMoney(item.gmvBdag)}</td></tr>)}</tbody></table></div></section>}

        <section className="business-card analytics-section"><div className="analytics-section-head"><div><p className="eyebrow">Atribución</p><h2>Origen de actividad</h2></div></div>{data.commerce.sources.length ? <div className="table-scroll"><table><thead><tr><th>Fuente</th><th>Vistas</th><th>Carritos</th><th>Pedidos</th><th>GMV</th></tr></thead><tbody>{data.commerce.sources.map((item) => <tr key={item.source}><td>{sourceLabels[item.source]}</td><td>{item.views}</td><td>{item.cartAdds}</td><td>{item.orders}</td><td>{formatMoney(item.gmvBdag)}</td></tr>)}</tbody></table></div> : <p className="muted-copy">Sin fuentes registradas en el período.</p>}</section>

        <div className="analytics-optional-grid">
          {data.ads.authorized && <section className="business-card analytics-section"><p className="eyebrow">Ads Manager</p><h2>Publicidad</h2><dl className="analytics-stats"><div><dt>Campañas activas</dt><dd>{data.ads.data.activeCampaigns}</dd></div><div><dt>Impresiones</dt><dd>{data.ads.data.impressions}</dd></div><div><dt>Clicks</dt><dd>{data.ads.data.clicks}</dd></div><div><dt>Gasto</dt><dd>{formatMoney(data.ads.data.spentBdag)}</dd></div><div><dt>GMV atribuido</dt><dd>{formatMoney(data.ads.data.attributedGmvBdag)}</dd></div><div><dt>ROAS</dt><dd>{data.ads.data.roas === null ? "—" : `${data.ads.data.roas}×`}</dd></div></dl></section>}
          {data.finance.authorized && <section className="business-card analytics-section"><p className="eyebrow">Operación</p><h2>Resumen financiero</h2><dl className="analytics-stats"><div><dt>Saldo BDAG</dt><dd>{formatMoney(data.finance.data.bdagBalance)}</dd></div><div><dt>Órdenes liquidadas</dt><dd>{data.finance.data.settledOrders}</dd></div><div><dt>Neto liquidado</dt><dd>{formatMoney(data.finance.data.sellerNetBdag)}</dd></div></dl></section>}
          {data.payouts.authorized && <section className="business-card analytics-section"><p className="eyebrow">Payouts</p><h2>Retiros</h2><dl className="analytics-stats"><div><dt>Pendientes</dt><dd>{data.payouts.data.pendingCount}</dd></div><div><dt>Enviando</dt><dd>{data.payouts.data.broadcastingCount}</dd></div><div><dt>Completados</dt><dd>{data.payouts.data.completedCount}</dd></div><div><dt>Valor completado</dt><dd>{formatMoney(data.payouts.data.completedBdag)}</dd></div></dl></section>}
        </div>
      </>}
    </main>
  );
}
