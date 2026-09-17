import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import {
  createStripeBdagCheckout,
  getBusinessBillingOverview,
  usdInputToCents,
  type BusinessBillingOverview,
  type StripeTopup,
} from "../../lib/businessBillingApi";
import { formatDate, formatMoney } from "../../lib/businessFormat";

const STATUS_LABELS: Record<StripeTopup["status"], string> = {
  created: "Pendiente", checkout_open: "Pendiente", paid: "Confirmando",
  credited: "Acreditado", failed: "Fallido", expired: "Expirado",
  requires_review: "Revisión requerida",
};

export function BusinessFinancePage() {
  const { currentBusiness, accessType } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const isOwner = accessType === "owner";
  const [searchParams] = useSearchParams();
  const stripeRedirect = searchParams.get("stripe");
  const [overview, setOverview] = useState<BusinessBillingOverview | null>(null);
  const [amount, setAmount] = useState("10.00");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestScope = useRef(ownerId);
  requestScope.current = ownerId;

  const load = useCallback(async () => {
    if (!ownerId) return;
    const expected = ownerId;
    setError(null);
    try {
      const next = await getBusinessBillingOverview(ownerId);
      if (requestScope.current === expected) setOverview(next);
    } catch (cause) {
      if (requestScope.current === expected) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las finanzas");
    } finally {
      if (requestScope.current === expected) setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    setOverview(null);
    setAmount("10.00");
    setSubmitting(false);
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (stripeRedirect !== "success" || !ownerId) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void load();
      if (attempts >= 6) window.clearInterval(timer);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [load, ownerId, stripeRedirect]);

  const cents = usdInputToCents(amount);
  const quote = useMemo(() => cents != null && overview?.stripe.bdagPerUsd
    ? (cents / 100) * overview.stripe.bdagPerUsd : null, [cents, overview]);
  const latestCredited = overview?.stripe.topups.some((topup) => topup.status === "credited") ?? false;

  const continueToStripe = async () => {
    if (!overview || cents == null || cents < overview.stripe.minimumUsdCents || cents > overview.stripe.maximumUsdCents) {
      setError("Ingresa un importe USD válido dentro del rango permitido.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const checkout = await createStripeBdagCheckout(cents);
      window.location.assign(checkout.checkoutUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar Stripe Checkout");
      setSubmitting(false);
    }
  };

  return <>
    <PageHeader eyebrow="Finanzas" title="Finanzas" description="Saldo empresarial y depósitos externos acreditados en el ledger canónico de Nelyon." />
    {stripeRedirect === "success" && <div className="finance-notice success-note" role="status">
      <strong>{latestCredited ? "Saldo actualizado." : "Pago recibido por Stripe. Estamos confirmando tu saldo."}</strong>
      {!latestCredited && <span>Confirmación pendiente.</span>}
    </div>}
    {stripeRedirect === "cancelled" && <div className="finance-notice readonly-note" role="status"><strong>Pago cancelado.</strong><span>No se agregó saldo.</span></div>}
    <InlineError message={error} />
    {loading && <div className="seller-state">Cargando finanzas…</div>}
    {!loading && overview && <>
      <section className="finance-overview-grid">
        <article className="finance-balance-card"><span>Saldo BDAG</span><strong>{formatMoney(overview.bdagBalance)}</strong><small>Autoridad: ledger Nelyon</small></article>
        <article className="finance-provider-card"><span>Stripe / Tarjeta</span><strong>{overview.stripe.available ? "Test mode disponible" : "Configuración pendiente"}</strong><small>Checkout alojado por Stripe · USD</small></article>
      </section>
      {isOwner ? <section className="seller-panel finance-topup-panel">
        <div><p className="eyebrow">Añadir saldo</p><h2>Financiar con tarjeta</h2><p>El pago se procesa de forma segura en Stripe. Nelyon nunca recibe los datos de tu tarjeta.</p></div>
        <label>Importe USD<input aria-label="Importe USD" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={!overview.stripe.available || submitting} /></label>
        <div className="finance-quote"><span>Recibirás</span><strong>{quote == null ? "—" : `${quote.toFixed(2)} BDAG`}</strong></div>
        <button className="primary-button" type="button" disabled={!overview.stripe.available || submitting} onClick={() => void continueToStripe()}>{submitting ? "Abriendo Stripe…" : "Continuar con Stripe"}</button>
        {!overview.stripe.available && <small>El proveedor Stripe test todavía no está configurado.</small>}
      </section> : <div className="readonly-note">Vista financiera de solo lectura. Solo el propietario puede añadir saldo.</div>}
      <BillingHistory topups={overview.stripe.topups} />
    </>}
  </>;
}

function BillingHistory({ topups }: { topups: StripeTopup[] }) {
  return <section className="seller-panel"><div className="section-heading"><div><p className="eyebrow">Stripe</p><h2>Historial de financiación</h2></div></div>
    {topups.length === 0 ? <div className="seller-state">Todavía no hay depósitos Stripe.</div> : <div className="seller-table-wrap"><table className="seller-table"><thead><tr><th>Fecha</th><th>USD</th><th>BDAG</th><th>Estado</th></tr></thead><tbody>{topups.map((topup) => <tr key={topup.id}>
      <td data-label="Fecha">{formatDate(topup.creditedAt ?? topup.createdAt)}</td>
      <td data-label="USD">${(topup.amountUsdCents / 100).toFixed(2)}</td>
      <td data-label="BDAG">{formatMoney(topup.bdagAmount)}</td>
      <td data-label="Estado"><StatusBadge status={STATUS_LABELS[topup.status]} /></td>
    </tr>)}</tbody></table></div>}
  </section>;
}
