import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { OperationConfirm } from "../components/OperationConfirm";
import { ErrorState, LoadingState } from "../components/PageState";
import {
  formatBdag,
  getProductDetail,
  moderateProduct,
  type OpsDetail,
} from "../lib/adminApi";
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "—");
export function MarketplaceProductDetailPage() {
  const { id = "" } = useParams(),
    [data, setData] = useState<OpsDetail | null>(null),
    [error, setError] = useState<string | null>(null),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    void getProductDetail(id)
      .then((value) => active && setData(value))
      .catch(
        (reason) =>
          active &&
          setError(reason instanceof Error ? reason.message : "Error"),
      );
    return () => {
      active = false;
    };
  }, [id, nonce]);
  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (!data) return <LoadingState />;
  const product = record(data.product),
    seller = record(data.seller),
    store = record(data.store),
    usage = record(data.usage),
    variants = Array.isArray(data.variants) ? data.variants.map(record) : [];
  const run = async (action: string, reason: string, idempotencyKey: string) => {
    await moderateProduct({
      id,
      action,
      reason,
      idempotencyKey,
    });
    setNonce((value) => value + 1);
  };
  return (
    <div className="detail">
      <Link className="back-link" to="/marketplace/products">
        ← Volver a productos
      </Link>
      <section className="detail-hero">
        <div>
          <p className="eyebrow">PRODUCTO</p>
          <h2>{text(product.title)}</h2>
          <p>
            {text(seller.display_name)} · {text(store.name)}
          </p>
        </div>
        <div>
          <em className="badge">{text(product.moderation_status)}</em>
          <strong>{formatBdag(product.price as string | number)}</strong>
        </div>
      </section>
      <div className="detail-grid">
        <section className="panel">
          <h3>Publicación</h3>
          <p>Estado: {text(product.status)}</p>
          <p>Moderación: {text(product.moderation_status)}</p>
          <p>Motivo: {text(product.moderation_reason)}</p>
        </section>
        <section className="panel">
          <h3>Inventario (solo lectura)</h3>
          {variants.map((variant) => (
            <p key={text(variant.id)}>
              {text(variant.sku)} · disponibles {String(variant.available ?? 0)}
            </p>
          ))}
        </section>
        <section className="panel">
          <h3>Uso creador</h3>
          <p>Showcase: {String(usage.showcase_refs ?? 0)}</p>
          <p>Feed/Reel: {String(usage.content_tag_refs ?? 0)}</p>
          <p>LIVE: {String(usage.live_refs ?? 0)}</p>
        </section>
        <OperationConfirm
          title="Moderación del producto"
          actions={[
            { value: "approve", label: "Aprobar" },
            {
              value: "reject",
              label: "Rechazar",
              reasonRequired: true,
              danger: true,
            },
            {
              value: "suspend",
              label: "Suspender",
              reasonRequired: true,
              danger: true,
            },
          ]}
          onRun={run}
        />
      </div>
    </div>
  );
}
