import type { ReactNode } from "react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark" aria-label="Nelyon Business">
      <span className="brand-glyph" aria-hidden="true">N</span>
      {!compact && (
        <span>
          <strong>Nelyon</strong>
          <small>Business</small>
        </span>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    approved: "Aprobado",
    pending: "En revisión",
    rejected: "Requiere cambios",
    suspended: "Suspendido",
    active: "Activa",
    draft: "Borrador",
  };
  return (
    <span className={`status-badge status-${status}`}>
      {labels[status] ?? status}
    </span>
  );
}

export function StatePanel({
  eyebrow,
  title,
  body,
  tone = "default",
  children,
}: {
  eyebrow?: string;
  title: string;
  body: string;
  tone?: "default" | "warning" | "danger";
  children?: ReactNode;
}) {
  return (
    <main className="centered-page">
      <section className={`state-panel state-panel-${tone}`}>
        <div className="state-icon" aria-hidden="true">
          {tone === "danger" ? "!" : tone === "warning" ? "·" : "✓"}
        </div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p className="state-copy">{body}</p>
        {children && <div className="state-actions">{children}</div>}
      </section>
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function InlineError({ message }: { message: string | null }) {
  return message ? (
    <div className="inline-error" role="alert">{message}</div>
  ) : null;
}
