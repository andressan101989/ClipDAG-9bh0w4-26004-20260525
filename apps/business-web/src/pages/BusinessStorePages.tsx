import { useEffect, useState, type FormEvent } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BusinessMediaPicker, BusinessMediaPreview } from "../components/BusinessMedia";
import { FormField, InlineError, PageHeader, StatusBadge } from "../components/BusinessUI";
import { searchBusinessMedia, setBusinessStoreMedia, type BusinessMediaItem } from "../lib/businessMediaApi";

function slugify(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function BusinessStoreForm({ setup = false }: { setup?: boolean }) {
  const { store, currentBusiness, createStore, updateStore, logout, hasCapability, accessType, retry } = useBusinessAuth();
  const canManage = setup || hasCapability("business.store.manage");
  const canUseMedia = !setup && hasCapability("business.store.manage") && (hasCapability("business.media.read") || hasCapability("business.media.manage"));
  const [name, setName] = useState(store?.name ?? "");
  const [slug, setSlug] = useState(store?.slug ?? "");
  const [description, setDescription] = useState(store?.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logo, setLogo] = useState<BusinessMediaItem | null>(null);
  const [banner, setBanner] = useState<BusinessMediaItem | null>(null);
  const [picker, setPicker] = useState<"logo" | "banner" | null>(null);
  const [savingMedia, setSavingMedia] = useState(false);

  useEffect(() => {
    const ids = [store?.logoAssetId, store?.bannerAssetId].filter((id): id is string => Boolean(id));
    if (!currentBusiness || ids.length === 0 || !canUseMedia) return;
    let alive = true;
    void searchBusinessMedia(currentBusiness.businessOwnerId, { kind: "image", status: "ready", assetIds: ids, limit: 2 }).then((page) => {
      if (!alive) return;
      setLogo(page.items.find((item) => item.assetId === store?.logoAssetId) ?? null);
      setBanner(page.items.find((item) => item.assetId === store?.bannerAssetId) ?? null);
    }).catch(() => { /* Existing identity remains untouched if preview resolution fails. */ });
    return () => { alive = false; };
  }, [canUseMedia, currentBusiness, store?.bannerAssetId, store?.logoAssetId]);

  async function saveMedia() {
    if (!store || !canUseMedia) return;
    setSavingMedia(true);
    setError(null);
    try {
      await setBusinessStoreMedia(store.id, logo?.assetId ?? store.logoAssetId, banner?.assetId ?? store.bannerAssetId);
      await retry();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la identidad visual");
    } finally {
      setSavingMedia(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setSubmitting(true);
    setSaved(false);
    setError(null);
    try {
      const input = { name, slug, description };
      if (setup) await createStore(input);
      else await updateStore(input);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la tienda");
    } finally {
      setSubmitting(false);
    }
  }

  const content = (
    <form className="business-form-card store-form" onSubmit={submit}>
      <div className="form-card-heading">
        <div>
          <h2>{setup ? "Crea tu tienda" : "Perfil de la tienda"}</h2>
          <p className="muted">Estos datos forman la identidad pública de tu Store.</p>
          {!canManage && <p className="readonly-note">Vista de solo lectura para miembros con business.store.read.</p>}
        </div>
        {store && <StatusBadge status={store.status} />}
      </div>
      <FormField label="Nombre de la tienda" hint="Entre 2 y 100 caracteres.">
        <input
          aria-label="Nombre de la tienda"
          minLength={2}
          maxLength={100}
          required
          disabled={!canManage}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (setup) setSlug(slugify(event.target.value));
          }}
        />
      </FormField>
      <FormField label="Dirección pública" hint="Letras minúsculas, números y guiones.">
        <div className="slug-input"><span>nelyon.app/store/</span><input aria-label="Dirección pública" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minLength={3} maxLength={80} required disabled={!canManage} value={slug} onChange={(event) => setSlug(slugify(event.target.value))} /></div>
      </FormField>
      <FormField label="Descripción" hint="Opcional. Máximo 1,000 caracteres.">
        <textarea aria-label="Descripción" maxLength={1000} rows={5} disabled={!canManage} value={description} onChange={(event) => setDescription(event.target.value)} />
      </FormField>
      {!setup && <section className="store-media-section">
        <div className="store-media-heading"><div><strong>Identidad visual</strong><p>Elige imágenes canónicas de Business Media. Los medios actuales se conservan hasta guardar.</p></div></div>
        <div className="store-media-grid">
          <div className="store-media-slot"><span>Logo</span><div className="store-media-preview store-logo-preview">{logo ? <BusinessMediaPreview item={logo} compact /> : <span>{store?.logoAssetId ? "Logo actual" : "Sin logo"}</span>}</div>{canUseMedia && <button className="secondary-button" type="button" onClick={() => setPicker("logo")}>Elegir de Media</button>}</div>
          <div className="store-media-slot"><span>Banner</span><div className="store-media-preview store-banner-preview">{banner ? <BusinessMediaPreview item={banner} compact /> : <span>{store?.bannerAssetId ? "Banner actual" : "Sin banner"}</span>}</div>{canUseMedia && <button className="secondary-button" type="button" onClick={() => setPicker("banner")}>Elegir de Media</button>}</div>
        </div>
        {canUseMedia ? <button className="text-button" type="button" disabled={savingMedia} onClick={() => void saveMedia()}>{savingMedia ? "Guardando…" : "Guardar identidad visual"}</button> : <p className="readonly-note">Se requieren business.store.manage y acceso a Media para cambiar logo o banner.</p>}
      </section>}
      <InlineError message={error} />
      {saved && <div className="inline-success" role="status">Cambios guardados.</div>}
      <div className="form-actions">
        {canManage && <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Guardando…" : setup ? "Crear tienda" : "Guardar cambios"}</button>}
        {setup && <button className="text-button" type="button" onClick={() => void logout()}>Cerrar sesión</button>}
      </div>
      <BusinessMediaPicker open={picker !== null} title={picker === "banner" ? "Elegir banner" : "Elegir logo"} selectedId={picker === "banner" ? banner?.assetId ?? store?.bannerAssetId ?? null : logo?.assetId ?? store?.logoAssetId ?? null} onClose={() => setPicker(null)} onSelect={(item) => { if (picker === "banner") setBanner(item); else setLogo(item); setPicker(null); }} />
    </form>
  );

  if (setup || store?.status === "draft") {
    return (
      <main className="onboarding-page store-setup-page">
        <div className="standalone-form-wrap">
          <p className="eyebrow">Store Setup</p>
          <h1>{setup ? "Da forma a tu espacio comercial" : "Completa el perfil de tu tienda"}</h1>
          <p className="page-lead">Una sola Store, conectada de forma segura a tu identidad de seller.</p>
          {content}
        </div>
      </main>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Tienda" title="Perfil de la tienda" description={canManage ? "Administra la identidad básica de tu storefront." : `Acceso ${accessType === "member" ? "como miembro" : "de solo lectura"}.`} />
      {content}
    </>
  );
}
