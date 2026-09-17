import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import { uploadBusinessOperationalMedia, type UploadProgress } from "../../lib/businessMediaApi";
import { formatDate, formatMoney } from "../../lib/businessFormat";
import {
  confirmReturnReceived,
  refundReturnWithoutShipment,
  respondDispute,
  respondReturn,
  searchDisputes,
  searchOrders,
  searchReturns,
  sendReturnLabel,
  type Cursor,
  type DisputeSummary,
  type OrderSummary,
  type ReturnSummary,
} from "../../lib/sellerCenterApi";

type View = "orders" | "returns" | "disputes";

const ORDER_STATUSES = [
  ["", "Todos"],
  ["pending_payment", "Pago pendiente"],
  ["confirmed", "Confirmados"],
  ["processing", "En procesamiento"],
  ["shipped", "Enviados"],
  ["delivered", "Entregados"],
  ["cancelled", "Cancelados"],
  ["expired", "Expirados"],
  ["refunded", "Reembolsados"],
  ["partially_refunded", "Parcialmente reembolsados"],
] as const;

function appendUnique<T extends { id: string }>(current: T[], incoming: T[]) {
  const seen = new Set(current.map((item) => item.id));
  const result = [...current];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function BusinessOrdersPage() {
  const { currentBusiness, accessType, hasCapability } = useBusinessAuth();
  const [params, setParams] = useSearchParams();
  const requested = params.get("view");
  const view: View = requested === "returns" || requested === "disputes" ? requested : "orders";
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const canOrders = hasCapability("business.orders.read") || hasCapability("business.orders.fulfill");
  const canReturns = hasCapability("business.returns.read") || hasCapability("business.returns.manage");
  const canDisputes = hasCapability("business.disputes.read") || hasCapability("business.disputes.respond");
  const [orderStatus, setOrderStatus] = useState("");
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [returns, setReturns] = useState<ReturnSummary[]>([]);
  const [disputes, setDisputes] = useState<DisputeSummary[]>([]);
  const [orderCursor, setOrderCursor] = useState<Cursor | null>(null);
  const [returnCursor, setReturnCursor] = useState<Cursor | null>(null);
  const [disputeCursor, setDisputeCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestScope = useRef("");
  const scopeKey = `${ownerId}:${view}:${view === "orders" ? orderStatus : ""}`;
  requestScope.current = scopeKey;

  const loadPage = useCallback(async (pageCursor?: Cursor, append = false) => {
    if (!ownerId) return;
    const expectedScope = `${ownerId}:${view}:${view === "orders" ? orderStatus : ""}`;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      if (view === "orders") {
        const page = await searchOrders(ownerId, { status: orderStatus || undefined, cursor: pageCursor });
        if (requestScope.current !== expectedScope) return;
        setOrders((current) => append ? appendUnique(current, page.items) : page.items);
        setOrderCursor(page.nextCursor);
      } else if (view === "returns") {
        const page = await searchReturns(ownerId, pageCursor);
        if (requestScope.current !== expectedScope) return;
        setReturns((current) => append ? appendUnique(current, page.items) : page.items);
        setReturnCursor(page.nextCursor);
      } else {
        const page = await searchDisputes(ownerId, pageCursor);
        if (requestScope.current !== expectedScope) return;
        setDisputes((current) => append ? appendUnique(current, page.items) : page.items);
        setDisputeCursor(page.nextCursor);
      }
    } catch (cause) {
      if (requestScope.current === expectedScope) setError(cause instanceof Error ? cause.message : "No se pudo cargar Seller Center");
    } finally {
      if (requestScope.current === expectedScope) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [orderStatus, ownerId, view]);

  useEffect(() => {
    setOrders([]);
    setReturns([]);
    setDisputes([]);
    setOrderCursor(null);
    setReturnCursor(null);
    setDisputeCursor(null);
  }, [ownerId]);

  useEffect(() => {
    if (view === "orders") { setOrders([]); setOrderCursor(null); }
    if (view === "returns") { setReturns([]); setReturnCursor(null); }
    if (view === "disputes") { setDisputes([]); setDisputeCursor(null); }
    void loadPage();
  }, [loadPage, view]);

  async function run(action: () => Promise<void>, label: string) {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSuccess(label);
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la acción");
    }
  }

  const allowedViews = ([canOrders && "orders", canReturns && "returns", canDisputes && "disputes"].filter(Boolean) as View[]);
  useEffect(() => {
    if (!allowedViews.includes(view) && allowedViews[0]) setParams({ view: allowedViews[0] }, { replace: true });
  }, [allowedViews.join("|"), setParams, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextCursor = view === "orders" ? orderCursor : view === "returns" ? returnCursor : disputeCursor;
  return <>
    <PageHeader eyebrow="Seller Center" title="Pedidos" description="Fulfillment, devoluciones y disputas del negocio seleccionado." />
    <div className="seller-subnav" role="tablist">
      {canOrders && <button className={view === "orders" ? "is-active" : ""} onClick={() => setParams({ view: "orders" })}>Pedidos</button>}
      {canReturns && <button className={view === "returns" ? "is-active" : ""} onClick={() => setParams({ view: "returns" })}>Devoluciones</button>}
      {canDisputes && <button className={view === "disputes" ? "is-active" : ""} onClick={() => setParams({ view: "disputes" })}>Disputas</button>}
    </div>
    {view === "orders" && <div className="seller-toolbar seller-filter-row"><label htmlFor="order-status">Estado</label><select id="order-status" aria-label="Filtrar pedidos por estado" value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>{ORDER_STATUSES.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</select></div>}
    <InlineError message={error} />
    {success && <div className="inline-success" role="status">{success}</div>}
    {loading && <div className="seller-state">Cargando {view === "orders" ? "pedidos" : view === "returns" ? "devoluciones" : "disputas"}…</div>}
    {!loading && view === "orders" && <OrdersList items={orders} />}
    {!loading && view === "returns" && <ReturnsList items={returns} isOwner={accessType === "owner"} canManage={hasCapability("business.returns.manage")} ownerId={ownerId} onRun={run} />}
    {!loading && view === "disputes" && <DisputesList items={disputes} canRespond={hasCapability("business.disputes.respond")} ownerId={ownerId} onRun={run} />}
    {!loading && nextCursor && <div className="seller-pagination"><button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadPage(nextCursor, true)}>{loadingMore ? "Cargando…" : "Ver más"}</button></div>}
  </>;
}

function OrdersList({ items }: { items: OrderSummary[] }) {
  if (!items.length) return <div className="seller-state">No hay pedidos en este negocio.</div>;
  return <div className="seller-table-wrap"><table className="seller-table"><thead><tr><th>Pedido</th><th>Estado</th><th>Artículos</th><th>Total</th><th>Fecha</th></tr></thead><tbody>{items.map((order) => <tr key={order.id}><td data-label="Pedido"><Link to={`/orders/${order.id}`}><strong>{order.order_number}</strong></Link></td><td data-label="Estado"><StatusBadge status={order.status} /></td><td data-label="Artículos">{order.items.map((item) => `${String(item.title)} × ${String(item.quantity)}`).join(", ")}</td><td data-label="Total">{formatMoney(Number(order.total), String(order.currency))}</td><td data-label="Fecha">{formatDate(order.created_at)}</td></tr>)}</tbody></table></div>;
}

function ReturnsList({ items, isOwner, canManage, ownerId, onRun }: { items: ReturnSummary[]; isOwner: boolean; canManage: boolean; ownerId: string; onRun: (action: () => Promise<void>, label: string) => Promise<void> }) {
  if (!items.length) return <div className="seller-state">No hay devoluciones.</div>;
  return <div className="seller-card-grid">{items.map((item) => <ReturnCard key={item.id} item={item} isOwner={isOwner} canManage={canManage} ownerId={ownerId} onRun={onRun} />)}</div>;
}

function ReturnCard({ item, isOwner, canManage, ownerId, onRun }: { item: ReturnSummary; isOwner: boolean; canManage: boolean; ownerId: string; onRun: (action: () => Promise<void>, label: string) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const shipment = item.shipment;
  const canRefundWithoutShipment = isOwner && item.status === "approved" && !shipment;
  const canConfirmReceived = isOwner && item.status === "approved" && shipment?.status === "shipped";
  async function label(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await onRun(async () => {
      setProgress({ phase: "reserving", percent: 0 });
      try {
        const asset = await uploadBusinessOperationalMedia(ownerId, "return_label", file, setProgress);
        await sendReturnLabel(item.id, asset);
      } finally { setProgress(null); }
    }, "Etiqueta enviada");
  }
  function confirmAndRun(message: string, action: () => Promise<void>, success: string) {
    if (window.confirm(message)) void onRun(action, success);
  }
  return <article className="seller-card return-card">
    <div><h2>{item.order_number}</h2><StatusBadge status={item.status} /></div>
    <p>{String(item.buyer_note ?? "Sin nota del comprador")}</p>
    <dl className="return-facts">
      <div><dt>Envío</dt><dd>{shipment ? String(shipment.status) : "Sin envío"}</dd></div>
      <div><dt>Etiqueta</dt><dd>{shipment?.label_sent_at || shipment?.return_label_asset_id ? "Enviada" : "Sin etiqueta"}</dd></div>
      <div><dt>Tracking</dt><dd>{shipment?.tracking_number || "—"}</dd></div>
      <div><dt>Recibido</dt><dd>{shipment?.received_at ? formatDate(shipment.received_at) : "—"}</dd></div>
      <div><dt>Reembolso</dt><dd>{item.refund_status || "Sin recibo"}</dd></div>
      <div><dt>Reembolsado</dt><dd>{item.refunded_at ? formatDate(item.refunded_at) : "—"}</dd></div>
      <div><dt>Resolución</dt><dd>{item.resolution_mode || "—"}</dd></div>
    </dl>
    <small>{formatDate(item.created_at)}</small>
    {item.status === "requested" && <div className="card-actions">
      {canManage && <button className="secondary-button" type="button" onClick={() => void onRun(() => respondReturn(item.id, "reject", "Solicitud revisada en Seller Center"), "Devolución rechazada")}>Rechazar</button>}
      {isOwner ? <button className="primary-button" type="button" onClick={() => void onRun(() => respondReturn(item.id, "approve", "Solicitud aprobada por el propietario"), "Devolución aprobada y hold financiado")}>Aprobar (propietario)</button> : <span className="readonly-note">La aprobación financiera requiere al propietario.</span>}
    </div>}
    {item.status === "approved" && canManage && <div className="card-actions"><input ref={input} className="visually-hidden" type="file" accept="application/pdf" onChange={(event) => void label(event)} /><button className="secondary-button" type="button" disabled={Boolean(progress)} onClick={() => input.current?.click()}>{progress ? `Subiendo ${progress.percent}%` : "Subir y enviar etiqueta"}</button></div>}
    {(canRefundWithoutShipment || canConfirmReceived) && <div className="financial-actions">
      {canRefundWithoutShipment && <button className="danger-button" type="button" onClick={() => confirmAndRun("¿Reembolsar este pedido y permitir que el comprador conserve el producto?", () => refundReturnWithoutShipment(item.id, "Reembolso sin envío confirmado por el propietario"), "Reembolso completado")}>Reembolsar y permitir que conserve el producto</button>}
      {canConfirmReceived && <button className="danger-button" type="button" onClick={() => confirmAndRun("¿Confirmar que recibiste la devolución y completar el reembolso?", () => confirmReturnReceived(item.id, "Devolución recibida por el propietario"), "Recepción confirmada y reembolso completado")}>Confirmar recibido y reembolsar</button>}
    </div>}
  </article>;
}

function DisputesList({ items, canRespond, ownerId, onRun }: { items: DisputeSummary[]; canRespond: boolean; ownerId: string; onRun: (action: () => Promise<void>, label: string) => Promise<void> }) {
  if (!items.length) return <div className="seller-state">No hay disputas.</div>;
  return <div className="seller-card-grid">{items.map((item) => <DisputeCard key={item.id} item={item} canRespond={canRespond} ownerId={ownerId} onRun={onRun} />)}</div>;
}

function DisputeCard({ item, canRespond, ownerId, onRun }: { item: DisputeSummary; canRespond: boolean; ownerId: string; onRun: (action: () => Promise<void>, label: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  async function respond() {
    await onRun(async () => {
      const evidence = file ? [await uploadBusinessOperationalMedia(ownerId, "dispute_evidence", file)] : [];
      await respondDispute(item.id, note, evidence);
    }, "Respuesta enviada");
  }
  const hasResponse = Boolean(item.seller_response);
  return <article className="seller-card"><div><h2>{item.order_number}</h2><StatusBadge status={item.status} /></div><p><strong>{String(item.reason_code)}</strong></p><p>{String(item.buyer_note ?? "Sin nota")}</p><small>{formatDate(item.created_at)}</small>{canRespond && !hasResponse && <div className="seller-form"><textarea aria-label="Respuesta a disputa" rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explica tu respuesta" /><input aria-label="Evidencia de disputa" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><button className="primary-button" type="button" disabled={!note.trim() && !file} onClick={() => void respond()}>Enviar respuesta</button></div>}{hasResponse && <div className="readonly-note">Respuesta enviada: {String((item.seller_response as Record<string, unknown>).note ?? "Con evidencia")}</div>}</article>;
}
