import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import { formatDate, formatMoney } from "../../lib/businessFormat";
import {
  getWithdrawalConfig,
  getWithdrawalQuote,
  requestBusinessPayout,
  searchBusinessPayouts,
  type BusinessPayout,
  type BusinessPayoutPage,
  type PayoutCursor,
  type PayoutStatus,
  type WithdrawalConfig,
  type WithdrawalQuote,
} from "../../lib/businessPayoutsApi";

const STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: "Pendiente", broadcasting: "Enviando", completed: "Completado", failed: "Fallido",
};

const EMPTY_SUMMARY: BusinessPayoutPage["summary"] = {
  pendingCount: 0,
  broadcastingCount: 0,
  completedCount: 0,
  failedCount: 0,
  totalCompletedBdag: 0,
};

export function BusinessPayoutsPage() {
  const { currentBusiness, accessType } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const isOwner = accessType === "owner";
  const scope = useRef(ownerId);
  scope.current = ownerId;
  const [items, setItems] = useState<BusinessPayout[]>([]);
  const [cursor, setCursor] = useState<PayoutCursor | null>(null);
  const [balance, setBalance] = useState(0);
  const [summary, setSummary] = useState<BusinessPayoutPage["summary"]>(EMPTY_SUMMARY);
  const [status, setStatus] = useState<PayoutStatus | "">("");
  const [config, setConfig] = useState<WithdrawalConfig | null>(null);
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [railKey, setRailKey] = useState("");
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedRail = useMemo(() => config?.rails.find((rail) => `${rail.token}:${rail.chainId}` === railKey) ?? null, [config, railKey]);

  const load = useCallback(async (append = false) => {
    if (!ownerId) return;
    const expected = ownerId;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const page = await searchBusinessPayouts(ownerId, { status: status || undefined, cursor: append ? cursor ?? undefined : undefined });
      if (scope.current !== expected) return;
      setBalance(page.bdagBalance);
      setSummary(page.summary);
      setItems((current) => append ? dedupe([...current, ...page.items]) : page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (scope.current === expected) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los retiros");
    } finally {
      if (scope.current === expected) { setLoading(false); setLoadingMore(false); }
    }
  }, [cursor, ownerId, status]);

  useEffect(() => {
    setItems([]); setCursor(null); setBalance(0); setSummary(EMPTY_SUMMARY); setConfig(null); setAmount(""); setDestination("");
    setRailKey(""); setQuote(null); setSuccess(null); setError(null);
    if (!ownerId) return;
    const expected = ownerId;
    void Promise.all([getWithdrawalConfig(), searchBusinessPayouts(ownerId, { status: status || undefined })])
      .then(([nextConfig, page]) => {
        if (scope.current !== expected) return;
        setConfig(nextConfig); setRailKey(`${nextConfig.rails[0]?.token ?? ""}:${nextConfig.rails[0]?.chainId ?? ""}`);
        setItems(page.items); setCursor(page.nextCursor); setBalance(page.bdagBalance); setSummary(page.summary);
      })
      .catch((cause) => { if (scope.current === expected) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los retiros"); })
      .finally(() => { if (scope.current === expected) setLoading(false); });
  }, [ownerId, status]);

  useEffect(() => {
    setQuote(null);
    if (!isOwner || !selectedRail || !amount.trim()) return;
    const timer = window.setTimeout(() => {
      void getWithdrawalQuote(amount, selectedRail).then(setQuote).catch(() => setQuote(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [amount, isOwner, selectedRail]);

  async function submit() {
    if (!quote || !selectedRail || !destination.trim()) return;
    const confirmed = window.confirm(
      `Retiras ${formatMoney(quote.grossBdag)} BDAG\n` +
      `Comisión ${formatMoney(quote.feeBdag)} BDAG\n` +
      `Recibes ${quote.estimatedStablecoinAmount} ${quote.token} · ${quote.network}\n` +
      `Destino ${destination.trim()}\n\nLos retiros no pueden revertirse después de transmitirse a la red.`,
    );
    if (!confirmed) return;
    setSubmitting(true); setError(null); setSuccess(null);
    try {
      await requestBusinessPayout(amount, destination.trim(), selectedRail);
      setSuccess("Retiro solicitado"); setAmount(""); setDestination(""); setQuote(null); setCursor(null);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo solicitar el retiro");
    } finally { setSubmitting(false); }
  }

  return <>
    <PageHeader eyebrow="Finanzas" title="Retiros" description="Solicita stablecoins desde el saldo BDAG canónico de tu negocio." />
    <div className="finance-subnav"><Link className="text-button" to="/finance">← Volver a Finanzas</Link></div>
    <InlineError message={error} />
    {success && <div className="finance-notice success-note" role="status"><strong>{success}</strong><span>Estado: Pendiente</span></div>}
    {loading && <div className="seller-state">Cargando retiros…</div>}
    {!loading && <>
      <section className="finance-overview-grid">
        <article className="finance-balance-card"><span>BDAG disponible</span><strong>{formatMoney(balance)}</strong><small>Autoridad: ledger Nelyon</small></article>
        <article className="finance-provider-card"><span>Retiros completados</span><strong>{summary.completedCount}</strong><small>La red confirma el estado final</small></article>
      </section>

      {isOwner ? <section className="seller-panel payout-form">
        <div><p className="eyebrow">Nuevo retiro</p><h2>Retirar stablecoin</h2><p>La política y la cotización se calculan en el servidor.</p></div>
        <div className="payout-form-grid">
          <label>Monto BDAG<input aria-label="Monto BDAG" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={config ? `Mínimo ${config.minimumBdag}` : ""} /></label>
          <label>Red y token<select aria-label="Red y token" value={railKey} onChange={(event) => setRailKey(event.target.value)}>{config?.rails.map((rail) => <option key={`${rail.token}:${rail.chainId}`} value={`${rail.token}:${rail.chainId}`}>{rail.token} · {rail.network}</option>)}</select></label>
          <label className="payout-destination">Dirección de destino<input aria-label="Dirección de destino" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="0x…" /></label>
        </div>
        {quote && <div className="payout-quote" aria-label="Cotización del retiro">
          <span>Retiras<strong>{formatMoney(quote.grossBdag)} BDAG</strong></span>
          <span>Comisión<strong>{formatMoney(quote.feeBdag)} BDAG</strong></span>
          <span>Recibes<strong>{quote.estimatedStablecoinAmount} {quote.token}</strong></span>
        </div>}
        <button className="primary-button" type="button" disabled={!quote || !destination.trim() || submitting} onClick={() => void submit()}>{submitting ? "Solicitando…" : "Solicitar retiro"}</button>
      </section> : <div className="readonly-note">Vista de retiros de solo lectura. Solo el propietario puede retirar fondos.</div>}

      <section className="seller-panel">
        <div className="section-heading"><div><p className="eyebrow">Historial</p><h2>Retiros</h2></div><select aria-label="Filtrar retiros" value={status} onChange={(event) => setStatus(event.target.value as PayoutStatus | "")}><option value="">Todos</option><option value="pending">Pendientes</option><option value="broadcasting">Enviando</option><option value="completed">Completados</option><option value="failed">Fallidos</option></select></div>
        {items.length === 0 ? <div className="seller-state">Todavía no hay retiros.</div> : <div className="seller-table-wrap"><table className="seller-table"><thead><tr><th>Fecha</th><th>Estado</th><th>Monto</th><th>Destino</th><th>Red</th></tr></thead><tbody>{items.map((item) => <PayoutRow key={item.id} item={item} />)}</tbody></table></div>}
        {cursor && <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? "Cargando…" : "Ver más"}</button>}
      </section>
    </>}
  </>;
}

function PayoutRow({ item }: { item: BusinessPayout }) {
  return <tr>
    <td data-label="Fecha">{formatDate(item.completedAt ?? item.broadcastAt ?? item.createdAt)}</td>
    <td data-label="Estado"><StatusBadge status={STATUS_LABELS[item.status]} />{item.status === "broadcasting" && <small>{item.confirmations}/{item.requiredConfirmations} confirmaciones</small>}</td>
    <td data-label="Monto"><strong>{formatMoney(item.bdagAmount)} BDAG</strong><small>Neto {item.stablecoinAmount} {item.tokenType}</small></td>
    <td data-label="Destino"><span>{item.maskedDestination}</span>{item.txHash && <small title={item.txHash}>{item.txHash.slice(0, 10)}…{item.txHash.slice(-6)}</small>}</td>
    <td data-label="Red">{item.tokenType} · {item.chainId === "8453" ? "Base" : "Ethereum"}</td>
  </tr>;
}

function dedupe(items: BusinessPayout[]) {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
}
