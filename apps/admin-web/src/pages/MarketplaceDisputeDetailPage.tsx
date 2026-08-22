import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { OperationConfirm } from "../components/OperationConfirm";
import { ErrorState, LoadingState } from "../components/PageState";
import {
  formatBdag,
  formatDate,
  getDisputeDetail,
  getDisputeEvidenceUrl,
  resolveDispute,
  type DisputeAffectedItem,
  type OpsDetail,
} from "../lib/adminApi";

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "—");
const reasonLabels: Record<string, string> = {
  not_received: "Pedido no recibido",
  damaged: "Producto dañado",
  incorrect_item: "Producto incorrecto",
  missing_items: "Faltan productos",
  other: "Otro motivo",
};
const optionText = (options: unknown[]) =>
  options
    .map((entry) => {
      const value = record(entry);
      return [value.name ?? value.option_name, value.value ?? value.option_value]
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(": ");
    })
    .filter(Boolean)
    .join(" · ");

function EvidenceGallery({ assetIds, party }: { assetIds: string[]; party: "comprador" | "vendedor" }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [retried, setRetried] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const load = useCallback(async (assetId: string) => {
    setFailed((current) => ({ ...current, [assetId]: false }));
    try {
      const url = await getDisputeEvidenceUrl(assetId);
      setUrls((current) => ({ ...current, [assetId]: url }));
    } catch {
      setFailed((current) => ({ ...current, [assetId]: true }));
    }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all(assetIds.map(async (assetId) => {
      try {
        const url = await getDisputeEvidenceUrl(assetId);
        if (active) setUrls((current) => ({ ...current, [assetId]: url }));
      } catch {
        if (active) setFailed((current) => ({ ...current, [assetId]: true }));
      }
    }));
    return () => { active = false; };
  }, [assetIds]);
  if (assetIds.length === 0) return <p className="muted-text">Sin evidencia fotográfica adjunta.</p>;
  return (
    <>
      <div className="dispute-evidence-gallery">
        {assetIds.map((assetId, index) => {
          const url = urls[assetId];
          if (failed[assetId]) return (
            <div className="evidence-failed" key={assetId}>
              <span>No se pudo cargar la foto.</span>
              <button type="button" onClick={() => void load(assetId)}>Reintentar</button>
            </div>
          );
          if (!url) return <div aria-label={`Cargando evidencia del ${party}`} className="evidence-loading" key={assetId} />;
          return (
            <button className="evidence-thumbnail" key={assetId} onClick={() => setPreview(url)} type="button">
              <img alt={`Evidencia del ${party} ${index + 1}`} onError={() => {
                if (!retried[assetId]) {
                  setRetried((current) => ({ ...current, [assetId]: true }));
                  void load(assetId);
                } else setFailed((current) => ({ ...current, [assetId]: true }));
              }} src={url} />
            </button>
          );
        })}
      </div>
      {preview ? (
        <div className="evidence-preview-backdrop" onMouseDown={() => setPreview(null)} role="presentation">
          <div aria-label={`Vista ampliada de evidencia del ${party}`} aria-modal="true" className="evidence-preview" onMouseDown={(event) => event.stopPropagation()} role="dialog">
            <button aria-label="Cerrar evidencia" className="evidence-preview-close" onClick={() => setPreview(null)} type="button">×</button>
            <img alt={`Evidencia ampliada del ${party}`} src={preview} />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function MarketplaceDisputeDetailPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<OpsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => {
    let active = true;
    setData(null);
    setError(null);
    void getDisputeDetail(id).then((value) => active && setData(value)).catch((reason) => active && setError(reason instanceof Error ? reason.message : "Error"));
    return () => { active = false; };
  }, [id]);
  useEffect(() => load(), [load, nonce]);
  if (error) return <ErrorState message={error} onRetry={() => setNonce((value) => value + 1)} />;
  if (!data) return <LoadingState label="Cargando expediente…" />;

  const dispute = record(data.dispute), order = record(data.order), buyer = record(data.buyer), seller = record(data.seller), store = record(data.store), payment = record(data.payment), allocation = record(data.allocation), settlement = record(data.settlement), reversal = record(data.reversal), decision = record(data.final_decision);
  const affectedItems = data.affected_items ?? [], buyerEvidence = data.buyer_evidence_asset_ids ?? [], sellerResponse = data.seller_response ?? null;
  const creatorAllocations = Array.isArray(data.creator_allocations) ? data.creator_allocations.map(record) : [];
  const reviews = Array.isArray(data.review_actions) ? data.review_actions.map(record) : [];
  const timeline = Array.isArray(data.timeline) ? data.timeline.map(record) : [];
  const terminal = Boolean(decision.id) || ["resolved", "rejected", "cancelled"].includes(text(dispute.status));
  const run = async (action: string, reason: string, idempotencyKey: string) => {
    await resolveDispute({ id, outcome: action, reason, note: "Operación desde OnSpace Admin", idempotencyKey });
    setNonce((value) => value + 1);
  };
  return (
    <div className="detail">
      <Link className="back-link" to="/marketplace/disputes">← Volver a disputas</Link>
      <section className="detail-hero"><div><p className="eyebrow">DISPUTA</p><h2>{text(order.order_number)}</h2><p>{formatDate(dispute.created_at)}</p></div><em className="badge warn">{text(dispute.status)}</em></section>
      <div className="detail-grid dispute-detail-grid">
        <section className="panel dispute-section-wide">
          <h3>PRODUCTO(S) RECLAMADO(S)</h3>
          <div className="dispute-items">
            {affectedItems.map((item: DisputeAffectedItem) => <article className="dispute-item" key={item.id}>
              <div className="dispute-item-image">{item.image_url ? <img alt={item.product_title} src={item.image_url} /> : <span>Sin imagen</span>}</div>
              <div><strong>{item.product_title}</strong>{item.variant_title ? <p>{item.variant_title}</p> : null}{optionText(item.options) ? <p>{optionText(item.options)}</p> : null}<small>SKU {item.sku} · Cantidad {item.quantity}</small><p>{formatBdag(item.line_total)} ({formatBdag(item.unit_price)} c/u)</p></div>
            </article>)}
          </div>
        </section>
        <div className="dispute-parties dispute-section-wide">
          <section className="panel"><p className="eyebrow">PRUEBAS DEL COMPRADOR</p><h3>{text(buyer.display_name || buyer.username)}</h3><p><strong>Motivo:</strong> {reasonLabels[text(dispute.reason_code)] ?? text(dispute.reason_code)}</p><p><strong>Explicación del comprador</strong></p><p>{text(dispute.buyer_note)}</p><small>Abierta {formatDate(dispute.created_at)}</small><EvidenceGallery assetIds={buyerEvidence} party="comprador" /></section>
          <section className="panel"><p className="eyebrow">RESPUESTA DEL VENDEDOR</p><h3>{text(seller.display_name)}</h3>{sellerResponse ? <><p><strong>Explicación del vendedor</strong></p><p>{sellerResponse.note ?? "Sin explicación escrita."}</p><small>Enviada {formatDate(sellerResponse.created_at)}</small><EvidenceGallery assetIds={sellerResponse.evidence_asset_ids} party="vendedor" /></> : <p className="muted-text">El vendedor aún no ha presentado una respuesta.</p>}</section>
        </div>
        <section className="panel"><h3>Expediente</h3><p>Comprador: {text(buyer.display_name || buyer.username)}</p><p>Vendedor: {text(seller.display_name)}</p><p>Tienda: {text(store.name)}</p></section>
        <section className="panel"><h3>Hechos financieros</h3><p>Pedido: {formatBdag(order.total as string | number)}</p><p>Pago: {text(payment.status)}</p><p>Asignación: {text(allocation.status)}</p><p>Liquidación: {text(settlement.status)}</p><p>Reversión: {reversal.id ? formatBdag(reversal.gross_amount as string | number) : "—"}</p><p>Decisión: {text(decision.outcome)}</p></section>
        <section className="panel"><h3>Revisión y cronología</h3>{reviews.map((item) => <p key={text(item.id)}>{text(item.action)} · {text(item.reason_code)} · {formatDate(item.created_at)}</p>)}{sellerResponse ? <p>seller_response_submitted · {formatDate(sellerResponse.created_at)}</p> : null}{timeline.map((item) => <p key={text(item.id)}>{text(item.event_type)} · {formatDate(item.created_at)}</p>)}</section>
        <section className="panel"><h3>Creator Commerce</h3>{creatorAllocations.length === 0 ? <p className="muted-text">Sin atribución de creador.</p> : creatorAllocations.map((item) => <p key={text(item.id)}>{text(item.creator_user_id)} · GMV {formatBdag(item.item_gmv as string | number)} · comisión {formatBdag(item.commission_amount as string | number)}</p>)}</section>
        {terminal ? <section className="panel dispute-section-wide"><h3>Decisión final</h3><p>Este expediente es de solo lectura.</p><p>{text(decision.outcome || dispute.status)}</p></section> : <OperationConfirm maxReasonLength={100} title="Resolver disputa" actions={[{value:"manual_review",label:"Enviar a revisión",reasonRequired:true},{value:"refund_buyer",label:"Reembolsar al comprador",reasonRequired:true,danger:true},{value:"release_seller",label:"Liberar fondos al vendedor",reasonRequired:true,danger:true},{value:"reject_claim",label:"Rechazar reclamo",reasonRequired:true,danger:true}]} onRun={run} />}
      </div>
    </div>
  );
}
