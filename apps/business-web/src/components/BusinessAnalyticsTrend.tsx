import type { AnalyticsDailyPoint } from "../lib/businessAnalyticsApi";

export type TrendMetric = "gmv" | "orders" | "units" | "productViews";

const labels: Record<TrendMetric, string> = {
  gmv: "GMV",
  orders: "pedidos",
  units: "unidades",
  productViews: "vistas de producto",
};

function pointValue(point: AnalyticsDailyPoint, metric: TrendMetric) {
  if (metric === "gmv") return Number(point.gmvBdag);
  return point[metric];
}
export function BusinessAnalyticsTrend({ points, metric }: { points: AnalyticsDailyPoint[]; metric: TrendMetric }) {
  const values = points.map((point) => {
    const value = pointValue(point, metric);
    return Number.isFinite(value) ? value : 0;
  });
  const maximum = Math.max(1, ...values);
  const width = 720;
  const height = 240;
  const coordinates = values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / maximum) * (height - 24) - 12;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="analytics-trend" role="img" aria-label={`Tendencia diaria de ${labels[metric]} en ${points.length} días`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={height - 12} x2={width} y2={height - 12} className="analytics-chart-axis" />
        {coordinates && <polyline points={coordinates} className="analytics-chart-line" />}
      </svg>
      <div className="analytics-trend-dates">
        <span>{points.at(0)?.day ?? "—"}</span>
        <span>{points.at(-1)?.day ?? "—"}</span>
      </div>
    </div>
  );
}
