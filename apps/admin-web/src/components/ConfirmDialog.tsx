import { useEffect, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  consequence,
  actionLabel,
  reason,
  danger = false,
  pending = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  consequence: string;
  actionLabel: string;
  reason?: string;
  danger?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null),
    confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
      if (event.key !== "Tab") return;
      const first = cancelRef.current,
        last = confirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending, onCancel]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={() => !pending && onCancel()}>
      <section
        aria-describedby="operation-dialog-description"
        aria-labelledby="operation-dialog-title"
        aria-modal="true"
        className="confirm-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={`dialog-icon ${danger ? "danger" : ""}`} aria-hidden="true">
          {danger ? "!" : "✓"}
        </div>
        <div>
          <p className="eyebrow">CONFIRMACIÓN REQUERIDA</p>
          <h2 id="operation-dialog-title">{title}</h2>
        </div>
        <p id="operation-dialog-description">{consequence}</p>
        {reason ? (
          <div className="dialog-reason">
            <strong>Motivo registrado</strong>
            <span>{reason}</span>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button className="secondary" disabled={pending} onClick={onCancel} ref={cancelRef} type="button">
            Cancelar
          </button>
          <button aria-busy={pending} className={danger ? "danger" : ""} disabled={pending} onClick={onConfirm} ref={confirmRef} type="button">
            {pending ? "Procesando…" : actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
