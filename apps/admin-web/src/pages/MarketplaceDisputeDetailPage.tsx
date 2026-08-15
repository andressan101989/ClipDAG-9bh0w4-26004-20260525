import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { OperationConfirm } from "../components/OperationConfirm";
import { ErrorState, LoadingState } from "../components/PageState";
import {
  formatBdag,
  formatDate,
  getDisputeDetail,
  resolveDispute,
  type OpsDetail,
} from "../lib/adminApi";
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "—");
export function MarketplaceDisputeDetailPage() {
  const { id = "" } = useParams(),
    [data, setData] = useState<OpsDetail | null>(null),
    [error, setError] = useState<string | null>(null),
    [nonce, setNonce] = useState(0);
  const load = useCallback(() => {
    let active = true;
    setData(null);
    setError(null);
    void getDisputeDetail(id)
      .then((value) => active && setData(value))
      .catch(
        (reason) =>
          active &&
          setError(reason instanceof Error ? reason.message : "Error"),
      );
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => load(), [load, nonce]);
  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={() => setNonce((value) => value + 1)}
      />
    );
  if (!data) return <LoadingState label="Cargando expediente…" />;
  const dispute = record(data.dispute),
    order = record(data.order),
    buyer = record(data.buyer),
    seller = record(data.seller),
    store = record(data.store),
    payment = record(data.payment),
    allocation = record(data.allocation),
    settlement = record(data.settlement),
    reversal = record(data.reversal),
    decision = record(data.final_decision),
    creatorAllocations = Array.isArray(data.creator_allocations)
      ? data.creator_allocations.map(record)
      : [],
    reviews = Array.isArray(data.review_actions)
      ? data.review_actions.map(record)
      : [],
    timeline = Array.isArray(data.timeline) ? data.timeline.map(record) : [];
  const run = async (action: string, reason: string, idempotencyKey: string) => {
    await resolveDispute({
      id,
      outcome: action,
      reason,
      note: "Operación desde OnSpace Admin",
      idempotencyKey,
    });
    setNonce((value) => value + 1);
  };
  return (
    <div className="detail">
      <Link className="back-link" to="/marketplace/disputes">
        ← Volver a disputas
      </Link>
      <section className="detail-hero">
        <div>
          <p className="eyebrow">DISPUTA</p>
          <h2>{text(order.order_number)}</h2>
          <p>{formatDate(dispute.created_at)}</p>
        </div>
        <em className="badge warn">{text(dispute.status)}</em>
      </section>
      <div className="detail-grid">
        <section className="panel">
          <h3>Expediente</h3>
          <p>Motivo: {text(dispute.reason_code)}</p>
          <p>Comprador: {text(buyer.display_name || buyer.username)}</p>
          <p>Vendedor: {text(seller.display_name)}</p>
          <p>Tienda: {text(store.name)}</p>
        </section>
        <section className="panel">
          <h3>Hechos financieros</h3>
          <p>Pedido: {formatBdag(order.total as string | number)}</p>
          <p>Pago: {text(payment.status)}</p>
          <p>Asignación: {text(allocation.status)}</p>
          <p>Liquidación: {text(settlement.status)}</p>
          <p>
            Reversión:{" "}
            {reversal.id
              ? formatBdag(reversal.gross_amount as string | number)
              : "—"}
          </p>
          <p>Decisión: {text(decision.outcome)}</p>
        </section>
        <section className="panel">
          <h3>Creator Commerce</h3>
          {creatorAllocations.length === 0 ? (
            <p className="muted-text">Sin atribución de creador.</p>
          ) : (
            creatorAllocations.map((item) => (
              <p key={text(item.id)}>
                {text(item.creator_user_id)} · GMV{" "}
                {formatBdag(item.item_gmv as string | number)} · comisión{" "}
                {formatBdag(item.commission_amount as string | number)}
              </p>
            ))
          )}
        </section>
        <section className="panel">
          <h3>Revisión y cronología</h3>
          {reviews.map((item) => (
            <p key={text(item.id)}>
              {text(item.action)} · {text(item.reason_code)} ·{" "}
              {formatDate(item.created_at)}
            </p>
          ))}
          {timeline.map((item) => (
            <p key={text(item.id)}>
              {text(item.event_type)} · {formatDate(item.created_at)}
            </p>
          ))}
        </section>
        <OperationConfirm
          title="Resolver disputa"
          actions={[
            {
              value: "manual_review",
              label: "Enviar a revisión",
              reasonRequired: true,
            },
            {
              value: "refund_buyer",
              label: "Reembolsar al comprador",
              reasonRequired: true,
              danger: true,
            },
            {
              value: "release_seller",
              label: "Liberar al vendedor",
              reasonRequired: true,
              danger: true,
            },
            {
              value: "reject_claim",
              label: "Rechazar reclamo",
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
