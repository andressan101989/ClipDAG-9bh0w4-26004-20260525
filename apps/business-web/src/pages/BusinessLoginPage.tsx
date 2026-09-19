import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useBusinessAuth } from "../auth/BusinessAuthProvider";
import { BUSINESS_BASE_PATH, validateBusinessReturnTo } from "../lib/businessRoutes";
import { BrandMark, FormField, InlineError } from "../components/BusinessUI";

export function BusinessLoginPage() {
  const { phase, login } = useBusinessAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase !== "signed_out" && phase !== "loading" && phase !== "error") {
    const returnTo = validateBusinessReturnTo(searchParams.get("returnTo"));
    return <Navigate to={returnTo.slice(BUSINESS_BASE_PATH.length)} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <BrandMark />
        <div>
          <p className="eyebrow light">Nelyon para negocios</p>
          <h1>Tu negocio, conectado a la comunidad Nelyon.</h1>
          <p>Gestiona tu presencia comercial desde una experiencia diseñada para propietarios.</p>
        </div>
        <small>Una cuenta. La misma identidad Nelyon.</small>
      </section>
      <section className="login-form-wrap">
        <form className="auth-card" onSubmit={submit}>
          <div className="mobile-brand"><BrandMark /></div>
          <p className="eyebrow">Nelyon Business</p>
          <h2>Accede con tu cuenta de Nelyon</h2>
          <p className="muted">No necesitas crear una cuenta empresarial separada.</p>
          <FormField label="Correo electrónico">
            <input
              aria-label="Correo electrónico"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <FormField label="Contraseña">
            <input
              aria-label="Contraseña"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>
          <InlineError message={error} />
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Accediendo…" : "Acceder a Business"}
          </button>
        </form>
      </section>
    </main>
  );
}
