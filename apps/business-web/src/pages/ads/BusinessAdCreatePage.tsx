import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { FormField, InlineError, PageHeader } from "../../components/BusinessUI";
import {
  createAdCampaignDraft,
  fetchAdConfig,
  searchEligibleAdProducts,
  setAdCampaignPlacements,
  type AdPlacement,
  type AdConfig,
  type AdsCursor,
  type EligibleAdProduct,
} from "../../lib/adsManagerApi";
import { formatMoney } from "../../lib/businessFormat";

const emptyConfig: AdConfig = { minimumBudgetBdag: 0, maximumBudgetBdag: 0, minimumDurationSeconds: 0, maximumDurationSeconds: 0 };
const placementOptions: Array<{ value: AdPlacement; eyebrow: string; label: string }> = [
  { value: "marketplace_home", eyebrow: "Marketplace", label: "Inicio" },
  { value: "marketplace_search", eyebrow: "Marketplace", label: "Búsqueda" },
  { value: "social_feed", eyebrow: "Nelyon", label: "Feed" },
];

function appendUnique(current: EligibleAdProduct[], incoming: EligibleAdProduct[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
function durationLabel(seconds: number) {
  const hours = seconds / 3600;
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24} días` : `${hours} horas`;
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function BusinessAdCreatePage() {
  const { currentBusiness, accessType, hasCapability } = useBusinessAuth();
  const navigate = useNavigate();
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const canManage = hasCapability("business.ads.manage");
  const [products, setProducts] = useState<EligibleAdProduct[]>([]);
  const [cursor, setCursor] = useState<AdsCursor | null>(null);
  const [config, setConfig] = useState(emptyConfig);
  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [startsAt, setStartsAt] = useState(() => localDateTime(new Date(Date.now() + 5 * 60_000)));
  const [endsAt, setEndsAt] = useState(() => localDateTime(new Date(Date.now() + 24 * 60 * 60_000)));
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [placements, setPlacements] = useState<AdPlacement[]>(["marketplace_home", "marketplace_search"]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestOwner = useRef("");
  requestOwner.current = ownerId;

  const loadProducts = useCallback(async (pageCursor?: AdsCursor, append = false) => {
    if (!ownerId) return;
    const expectedOwner = ownerId;
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const page = await searchEligibleAdProducts(ownerId, pageCursor);
      if (requestOwner.current !== expectedOwner) return;
      setProducts((current) => append ? appendUnique(current, page.items) : page.items);
      setProductId((current) => current || page.items[0]?.id || "");
      setCursor(page.nextCursor);
    } catch (cause) {
      if (requestOwner.current === expectedOwner) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los productos");
    } finally {
      if (requestOwner.current === expectedOwner) { setLoading(false); setLoadingMore(false); }
    }
  }, [ownerId]);

  useEffect(() => {
    setProducts([]); setProductId(""); setCursor(null); setError(null);
    void Promise.all([
      loadProducts(),
      fetchAdConfig().then((value) => { if (requestOwner.current === ownerId) { setConfig(value); setBudget(String(value.minimumBudgetBdag)); } }),
    ]).catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo preparar la campaña"));
  }, [loadProducts, ownerId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !productId) return;
    setSaving(true); setError(null);
    try {
      const campaignId = draftId ?? String((await createAdCampaignDraft({
          productId,
          name,
          budgetBdag: Number(budget),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        })).id);
      if (!draftId) setDraftId(campaignId);
      await setAdCampaignPlacements(campaignId, placements);
      navigate(`/ads/${campaignId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la campaña");
      setSaving(false);
    }
  }

  function togglePlacement(value: AdPlacement) {
    setPlacements((current) => current.includes(value)
      ? current.filter((placement) => placement !== value)
      : [...current, value]);
  }

  return <>
    <PageHeader eyebrow="Ads Manager" title="Nueva campaña" description="Crea un draft sin mover BDAG. La financiación ocurre únicamente al activar." action={<Link className="text-button" to="/ads">Volver a campañas</Link>} />
    <InlineError message={error} />
    {loading && <div className="seller-state">Cargando productos elegibles y configuración…</div>}
    {!loading && products.length === 0 && !error && <div className="seller-state"><strong>No hay productos elegibles</strong><p>El producto debe estar activo, aprobado, publicado, en BDAG y con inventario disponible.</p></div>}
    {!loading && products.length > 0 && <form className="ads-create-layout" onSubmit={(event) => void submit(event)}>
      <section className="business-card ads-form-section">
        <p className="eyebrow">1 · Producto</p><h2>Selecciona qué promocionar</h2>
        <div className="ads-product-picker" role="radiogroup" aria-label="Producto elegible">
          {products.map((product) => <label className={productId === product.id ? "ads-product-option is-selected" : "ads-product-option"} key={product.id}>{product.thumbnailUrl ? <img src={product.thumbnailUrl} alt="" /> : <span className="product-placeholder">◇</span>}<span><strong>{product.title}</strong><small>{formatMoney(product.price, product.currency)}</small></span><input type="radio" name="product" value={product.id} checked={productId === product.id} onChange={() => setProductId(product.id)} /></label>)}
        </div>
        {cursor && <button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadProducts(cursor, true)}>{loadingMore ? "Cargando…" : "Ver más productos"}</button>}
      </section>
      <section className="business-card ads-form-section">
        <p className="eyebrow">2 · Presupuesto</p><h2>Define la intención de inversión</h2>
        <FormField label="Nombre de campaña" hint="Opcional; el producto seguirá siendo el creative canónico."><input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="Ej. Lanzamiento de septiembre" /></FormField>
        <FormField label="Presupuesto BDAG" hint={`Permitido por Ads: ${formatMoney(config.minimumBudgetBdag)} a ${formatMoney(config.maximumBudgetBdag)}.`}><input type="number" step="0.00000001" min={config.minimumBudgetBdag} max={config.maximumBudgetBdag} required value={budget} onChange={(event) => setBudget(event.target.value)} /></FormField>
      </section>
      <section className="business-card ads-form-section">
        <p className="eyebrow">3 · Programación</p><h2>Elige la ventana</h2>
        <div className="form-grid"><FormField label="Inicio"><input type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></FormField><FormField label="Fin" hint={`Duración permitida: ${durationLabel(config.minimumDurationSeconds)} a ${durationLabel(config.maximumDurationSeconds)}.`}><input type="datetime-local" required value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></FormField></div>
      </section>
      <section className="business-card ads-form-section">
        <p className="eyebrow">4 · Ubicaciones</p><h2>Elige dónde puede mostrarse</h2>
        <p className="muted-copy">Selecciona al menos una ubicación. Puedes cambiarla mientras la campaña siga en draft.</p>
        <div className="ads-placement-grid">
          {placementOptions.map((option) => <label key={option.value} className={placements.includes(option.value) ? "ads-placement-option is-selected" : "ads-placement-option"}>
            <input type="checkbox" checked={placements.includes(option.value)} onChange={() => togglePlacement(option.value)} />
            <span><small>{option.eyebrow}</small><strong>{option.label}</strong></span>
          </label>)}
        </div>
        {placements.length === 0 && <span className="field-error">Selecciona al menos una ubicación.</span>}
      </section>
      <section className="business-card ads-review-card">
        <p className="eyebrow">5 · Revisión</p><h2>Crear borrador</h2>
        <p>Este paso no debita BDAG ni reserva fondos.</p>
        {accessType === "member" && <div className="readonly-note">Podrás preparar el draft. La activación y financiación requerirán al propietario.</div>}
        {draftId && error && <Link className="text-button" to={`/ads/${draftId}`}>Abrir el draft y reintentar ubicaciones</Link>}
        <button className="primary-button" type="submit" disabled={saving || !productId || placements.length === 0}>{saving ? "Guardando…" : draftId ? "Reintentar ubicaciones" : "Crear campaña draft"}</button>
      </section>
    </form>}
  </>;
}
