import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { OperationConfirm } from "../components/OperationConfirm";
import { ErrorState, LoadingState } from "../components/PageState";
import {
  formatBdag,
  getSellerDetail,
  moderateSeller,
  type OpsDetail,
} from "../lib/adminApi";
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "—");
export function MarketplaceSellerDetailPage() {
  const { id = "" } = useParams(),
    [data, setData] = useState<OpsDetail | null>(null),
    [error, setError] = useState<string | null>(null),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    void getSellerDetail(id)
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
  const seller = record(data.seller),
    store = record(data.store),
    products = record(data.product_counts),
    orders = record(data.order_summary);
  const run = async (action: string, reason: string, idempotencyKey: string) => {
    await moderateSeller({
      id,
      action,
      reason,
      idempotencyKey,
    });
    setNonce((value) => value + 1);
  };
  return (
    <div className="detail">
      <Link className="back-link" to="/marketplace/sellers">
        ← Volver a vendedores
      </Link>
      <section className="detail-hero">
        <div>
          <p className="eyebrow">VENDEDOR</p>
          <h2>{text(seller.display_name)}</h2>
          <p>{id}</p>
        </div>
        <em className="badge">{text(seller.status)}</em>
      </section>
      <div className="detail-grid">
        <section className="panel">
          <h3>Tienda</h3>
          <p>{text(store.name)}</p>
          <p>Estado: {text(store.status)}</p>
          <p>
            La tienda sigue la autoridad canónica del vendedor; B8B no edita
            branding.
          </p>
        </section>
        <section className="panel">
          <h3>Operación</h3>
          <p>Productos: {String(products.total ?? 0)}</p>
          <p>Requieren atención: {String(products.attention ?? 0)}</p>
          <p>Pedidos: {String(orders.orders ?? 0)}</p>
          <p>GMV canónico: {formatBdag(orders.paid_gmv as string | number)}</p>
        </section>
        <OperationConfirm
          maxReasonLength={500}
          title="Moderación del vendedor"
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
            { value: "restore", label: "Restaurar" },
          ]}
          onRun={run}
        />
      </div>
    </div>
  );
}
