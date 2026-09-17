import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useBusinessAuth } from "../../auth/BusinessAuthProvider";
import { FormField, InlineError, PageHeader, StatusBadge } from "../../components/BusinessUI";
import { formatMoney } from "../../lib/businessFormat";
import { searchShippingProfiles, upsertShippingProfile, type Cursor, type ShippingProfile, type ShippingRegion } from "../../lib/sellerCenterApi";

type RegionDraft = {
  key: string;
  id: string | null;
  status: string;
  countryCode: string;
  regionCode: string;
  price: string;
  freeShippingThreshold: string;
  transitMin: string;
  transitMax: string;
};

function newRegion(region?: ShippingRegion): RegionDraft {
  return {
    key: region?.id ?? crypto.randomUUID(),
    id: region?.id ?? null,
    status: typeof region?.status === "string" ? region.status : "active",
    countryCode: String(region?.country_code ?? "US"),
    regionCode: String(region?.region_code ?? ""),
    price: String(region?.shipping_price ?? 0),
    freeShippingThreshold: region?.free_shipping_threshold == null ? "" : String(region.free_shipping_threshold),
    transitMin: String(region?.transit_days_min ?? 2),
    transitMax: String(region?.transit_days_max ?? 7),
  };
}

function appendUnique(current: ShippingProfile[], incoming: ShippingProfile[]) {
  const seen = new Set(current.map((item) => item.id));
  const result = [...current];
  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function BusinessShippingPage() {
  const { currentBusiness, hasCapability } = useBusinessAuth();
  const canManage = hasCapability("business.catalog.manage");
  const ownerId = currentBusiness?.businessOwnerId ?? "";
  const [items, setItems] = useState<ShippingProfile[]>([]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShippingProfile | null>(null);
  const [regions, setRegions] = useState<RegionDraft[]>([newRegion()]);
  const [open, setOpen] = useState(false);
  const activeOwner = useRef(ownerId);
  activeOwner.current = ownerId;

  const loadPage = useCallback(async (cursor?: Cursor, append = false) => {
    if (!ownerId) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await searchShippingProfiles(ownerId, cursor);
      if (activeOwner.current !== ownerId) return;
      setItems((current) => append ? appendUnique(current, page.items) : page.items);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (activeOwner.current === ownerId) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los envíos");
    } finally {
      if (activeOwner.current === ownerId) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [ownerId]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void loadPage();
  }, [loadPage]);

  function openEditor(profile?: ShippingProfile) {
    setEditing(profile ?? null);
    setRegions(profile?.regions.length ? profile.regions.map((region) => newRegion(region)) : [newRegion()]);
    setOpen(true);
  }

  function updateRegion(index: number, patch: Partial<RegionDraft>) {
    setRegions((current) => current.map((region, position) => position === index ? { ...region, ...patch } : region));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentBusiness?.store || !canManage) return;
    const form = new FormData(event.currentTarget);
    setError(null);
    try {
      await upsertShippingProfile({
        p_profile_id: editing?.id ?? null,
        p_store_id: currentBusiness.store.id,
        p_name: String(form.get("name")),
        p_processing_days_min: Number(form.get("processingMin")),
        p_processing_days_max: Number(form.get("processingMax")),
        p_ships_from_country: String(form.get("country")).toUpperCase(),
        p_return_policy_summary: String(form.get("returnPolicy")),
        p_regions: regions.map((region) => ({
          id: region.id,
          status: region.status,
          country_code: region.countryCode.toUpperCase(),
          region_code: region.regionCode.trim() || null,
          shipping_price: Number(region.price),
          free_shipping_threshold: region.freeShippingThreshold === "" ? null : Number(region.freeShippingThreshold),
          transit_days_min: Number(region.transitMin),
          transit_days_max: Number(region.transitMax),
        })),
      });
      setOpen(false);
      setEditing(null);
      await loadPage();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el perfil");
    }
  }

  return <>
    <PageHeader eyebrow="Productos" title="Perfiles de envío" description="Reglas canónicas de origen, procesamiento y regiones." action={canManage ? <button className="primary-button" type="button" onClick={() => openEditor()}>Nuevo perfil</button> : undefined} />
    <div className="seller-subnav"><Link to="/products">Catálogo</Link><Link className="is-active" to="/products/shipping">Envíos</Link></div>
    <InlineError message={error} />
    {loading ? <div className="seller-state">Cargando perfiles…</div> : items.length === 0 ? <div className="seller-state">No hay perfiles de envío.</div> : <div className="seller-card-grid">{items.map((item) => <article className="seller-card" key={item.id}><div><h2>{item.name}</h2><StatusBadge status={String(item.configuration_status ?? item.status)} /></div><p>Origen: {String(item.ships_from_country)} · Procesamiento: {String(item.processing_days_min)}–{String(item.processing_days_max)} días</p><ul>{item.regions.map((region, index) => <li key={region.id ?? `${item.id}-${index}`}>{String(region.country_code)}{region.region_code ? ` · ${region.region_code}` : ""} · {formatMoney(Number(region.shipping_price), "BDAG")}</li>)}</ul>{canManage && <button className="secondary-button" type="button" onClick={() => openEditor(item)}>Editar</button>}</article>)}</div>}
    {!loading && nextCursor && <div className="seller-pagination"><button className="secondary-button" type="button" disabled={loadingMore} onClick={() => void loadPage(nextCursor, true)}>{loadingMore ? "Cargando…" : "Ver más"}</button></div>}
    {open && <div className="media-dialog-backdrop"><form className="media-dialog seller-dialog shipping-dialog" onSubmit={(event) => void save(event)}>
      <header><h2>{editing ? "Editar perfil" : "Nuevo perfil"}</h2><button className="icon-button" type="button" aria-label="Cerrar editor" onClick={() => setOpen(false)}>×</button></header>
      <FormField label="Nombre"><input name="name" required defaultValue={editing?.name ?? ""} /></FormField>
      <div className="two-column"><FormField label="Procesamiento mínimo"><input name="processingMin" type="number" min="0" max="30" required defaultValue={String(editing?.processing_days_min ?? 1)} /></FormField><FormField label="Procesamiento máximo"><input name="processingMax" type="number" min="0" max="60" required defaultValue={String(editing?.processing_days_max ?? 3)} /></FormField></div>
      <FormField label="País de origen"><input name="country" required maxLength={2} defaultValue={String(editing?.ships_from_country ?? "US")} /></FormField>
      <FormField label="Política de devoluciones"><textarea name="returnPolicy" required rows={3} defaultValue={String(editing?.return_policy_summary ?? "Devoluciones según la política de la tienda.")} /></FormField>
      <div className="section-heading"><div><h3>Regiones</h3><p>Conserva, edita o agrega todas las zonas atendidas por este perfil.</p></div><button className="secondary-button" type="button" onClick={() => setRegions((current) => [...current, newRegion()])}>Agregar región</button></div>
      <div className="shipping-regions">{regions.map((region, index) => <fieldset className="shipping-region" key={region.key}><legend>Región {index + 1}</legend>
        <div className="two-column"><FormField label="País"><input aria-label={`País región ${index + 1}`} required maxLength={2} value={region.countryCode} onChange={(event) => updateRegion(index, { countryCode: event.target.value })} /></FormField><FormField label="Código regional"><input aria-label={`Código región ${index + 1}`} value={region.regionCode} onChange={(event) => updateRegion(index, { regionCode: event.target.value })} /></FormField></div>
        <div className="two-column"><FormField label="Precio BDAG"><input aria-label={`Precio región ${index + 1}`} type="number" min="0" step="0.01" required value={region.price} onChange={(event) => updateRegion(index, { price: event.target.value })} /></FormField><FormField label="Envío gratis desde"><input aria-label={`Envío gratis región ${index + 1}`} type="number" min="0" step="0.01" value={region.freeShippingThreshold} onChange={(event) => updateRegion(index, { freeShippingThreshold: event.target.value })} /></FormField></div>
        <div className="two-column"><FormField label="Tránsito mínimo"><input aria-label={`Tránsito mínimo región ${index + 1}`} type="number" min="1" required value={region.transitMin} onChange={(event) => updateRegion(index, { transitMin: event.target.value })} /></FormField><FormField label="Tránsito máximo"><input aria-label={`Tránsito máximo región ${index + 1}`} type="number" min="1" required value={region.transitMax} onChange={(event) => updateRegion(index, { transitMax: event.target.value })} /></FormField></div>
        <button className="text-button" type="button" disabled={regions.length === 1} onClick={() => setRegions((current) => current.filter((_, position) => position !== index))}>Quitar región</button>
      </fieldset>)}</div>
      <button className="primary-button" type="submit">Guardar perfil</button>
    </form></div>}
  </>;
}
