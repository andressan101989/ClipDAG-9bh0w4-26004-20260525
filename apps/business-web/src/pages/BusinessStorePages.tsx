import { useState, type FormEvent } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { FormField, InlineError, PageHeader, StatusBadge } from "../components/BusinessUI";

function slugify(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function BusinessStoreForm({ setup = false }: { setup?: boolean }) {
  const { store, createStore, updateStore, logout, hasCapability, accessType } = useBusinessAuth();
  const canManage = setup || hasCapability("business.store.manage");
  const [name, setName] = useState(store?.name ?? "");
  const [slug, setSlug] = useState(store?.slug ?? "");
  const [description, setDescription] = useState(store?.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <div className="slug-input"><span>nelyon.com/store/</span><input aria-label="Dirección pública" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" minLength={3} maxLength={80} required disabled={!canManage} value={slug} onChange={(event) => setSlug(slugify(event.target.value))} /></div>
      </FormField>
      <FormField label="Descripción" hint="Opcional. Máximo 1,000 caracteres.">
        <textarea aria-label="Descripción" maxLength={1000} rows={5} disabled={!canManage} value={description} onChange={(event) => setDescription(event.target.value)} />
      </FormField>
      <div className="deferred-media">
        <span aria-hidden="true">▧</span>
        <div><strong>Logo y banner</strong><p>La biblioteca de medios llegará en una próxima fase. Tus medios actuales se conservan.</p></div>
      </div>
      <InlineError message={error} />
      {saved && <div className="inline-success" role="status">Cambios guardados.</div>}
      <div className="form-actions">
        {canManage && <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Guardando…" : setup ? "Crear tienda" : "Guardar cambios"}</button>}
        {setup && <button className="text-button" type="button" onClick={() => void logout()}>Cerrar sesión</button>}
      </div>
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
