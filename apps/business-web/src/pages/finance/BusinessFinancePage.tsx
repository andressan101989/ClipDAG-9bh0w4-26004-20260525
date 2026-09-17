import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_TOPUP_STATUSES = new Set<StripeTopup["status"]>(["credited", "failed", "expired", "requires_review"]);

export function BusinessFinancePage() {
  const { currentBusiness, accessType, hasCapability } = useBusinessAuth();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const isOwner = accessType === "owner";
  const [searchParams] = useSearchParams();
  const stripeRedirect = searchParams.get("stripe");
  const topupParam = searchParams.get("topup");
  const redirectTopupId = topupParam && UUID_PATTERN.test(topupParam) ? topupParam.toLowerCase() : null;
  const [overview, setOverview] = useState<BusinessBillingOverview | null>(null);
  const [amount, setAmount] = useState("10.00");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestScope = useRef(ownerId);
  const pollAttempts = useRef(0);
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
    pollAttempts.current = 0;
  }, [ownerId, redirectTopupId, stripeRedirect]);

  const targetTopup = redirectTopupId
    ? overview?.stripe.topups.find((topup) => topup.id.toLowerCase() === redirectTopupId)
    : undefined;
  const targetStatus = targetTopup?.status;

  useEffect(() => {
    if (stripeRedirect !== "success" || !ownerId || (targetStatus && TERMINAL_TOPUP_STATUSES.has(targetStatus))) return;
    const timer = window.setInterval(() => {
      pollAttempts.current += 1;
      void load();
      if (pollAttempts.current >= 6) window.clearInterval(timer);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [load, ownerId, stripeRedirect, targetStatus]);

  const cents = usdInputToCents(amount);
  const quote = useMemo(() => cents != null && overview?.stripe.bdagPerUsd
    ? (cents / 100) * overview.stripe.bdagPerUsd : null, [cents, overview]);

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
    {stripeRedirect === "success" && <StripeSuccessNotice target={targetTopup} />}
    {stripeRedirect === "cancelled" && <div className="finance-notice readonly-note" role="status"><strong>Pago cancelado.</strong><span>No se agregó saldo.</span></div>}
    <InlineError message={error} />
    {loading && <div className="seller-state">Cargando finanzas…</div>}
    {!loading && overview && <>
      {(hasCapability("business.payouts.read") || hasCapability("business.payouts.manage")) && <div className="finance-subnav"><Link className="secondary-button" to="/finance/payouts">Retiros</Link></div>}
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

function StripeSuccessNotice({ target }: { target: StripeTopup | undefined }) {
  if (!target) return <div className="finance-notice readonly-note" role="status"><strong>Estamos verificando el estado del pago.</strong></div>;
  if (target.status === "credited") return <div className="finance-notice success-note" role="status"><strong>Saldo actualizado.</strong></div>;
  if (target.status === "failed") return <div className="finance-notice readonly-note" role="status"><strong>El pago no pudo confirmarse.</strong></div>;
  if (target.status === "expired") return <div className="finance-notice readonly-note" role="status"><strong>La sesión de pago expiró.</strong></div>;
  if (target.status === "requires_review") return <div className="finance-notice readonly-note" role="status"><strong>El pago requiere revisión.</strong></div>;
  return <div className="finance-notice success-note" role="status">
    <strong>Pago recibido por Stripe. Estamos confirmando tu saldo.</strong>
    <span>Confirmación pendiente.</span>
  </div>;
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
