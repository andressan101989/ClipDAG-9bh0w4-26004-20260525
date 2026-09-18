import { useState, type FormEvent } from "react";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BrandMark, FormField, InlineError } from "../components/BusinessUI";
import { BusinessInvitationNotice } from "./team/BusinessInvitationInboxPage";

export function BusinessOnboardingPage({ rejected = false }: { rejected?: boolean }) {
  const { seller, applySeller, updateSeller, logout } = useBusinessAuth();
  const [displayName, setDisplayName] = useState(seller?.displayName ?? "");
  const [note, setNote] = useState(seller?.applicationNote ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const input = { displayName, applicationNote: note };
      if (rejected) await updateSeller(input);
      else await applySeller(input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la solicitud");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding-page">
      <header className="onboarding-topbar">
        <BrandMark />
        <div className="invitation-page-actions"><BusinessInvitationNotice /><button className="text-button" type="button" onClick={() => void logout()}>Cerrar sesión</button></div>
      </header>
      <div className="onboarding-grid">
        <section className="onboarding-copy">
          <p className="eyebrow">Primer paso</p>
          <h1>{rejected ? "Actualiza tu solicitud" : "Activa tu presencia comercial"}</h1>
          <p>
            {rejected
              ? "Puedes corregir los datos permitidos y reenviar la solicitud para una nueva revisión."
              : "Solicita acceso como seller usando la misma identidad de tu cuenta Nelyon."}
          </p>
          <ol className="step-list">
            <li className="is-current"><span>1</span><div><strong>Solicitud</strong><small>Identidad visible del seller</small></div></li>
            <li><span>2</span><div><strong>Revisión</strong><small>Validación por Nelyon</small></div></li>
            <li><span>3</span><div><strong>Tienda</strong><small>Configura tu storefront</small></div></li>
          </ol>
        </section>
        <form className="business-form-card" onSubmit={submit}>
          <h2>Datos de la solicitud</h2>
          <p className="muted">Solo pedimos los campos admitidos por el Seller Center actual.</p>
          <FormField label="Nombre visible" hint="Entre 2 y 80 caracteres.">
            <input aria-label="Nombre visible" minLength={2} maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </FormField>
          <FormField label="Cuéntanos sobre tu tienda" hint="Opcional. Máximo 1,000 caracteres.">
            <textarea aria-label="Cuéntanos sobre tu tienda" maxLength={1000} rows={5} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
          <InlineError message={error} />
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Enviando…" : rejected ? "Actualizar y reenviar" : "Enviar solicitud"}
          </button>
        </form>
      </div>
    </main>
  );
}
