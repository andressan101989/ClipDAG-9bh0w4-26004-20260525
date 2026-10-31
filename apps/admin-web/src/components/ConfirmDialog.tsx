import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  open,
  title,
  consequence,
  actionLabel,
  reason,
  error,
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
  error?: string | null;
  danger?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null),
    confirmRef = useRef<HTMLButtonElement>(null),
    backdropRef = useRef<HTMLDivElement>(null),
    dialogRef = useRef<HTMLElement>(null),
    returnFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (!open || !backdrop) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children).filter((element) => element !== backdrop).map((element) => ({element, hadInert:element.hasAttribute("inert"), ariaHidden:element.getAttribute("aria-hidden")}));
    for (const {element} of background) {element.setAttribute("inert", ""); element.setAttribute("aria-hidden", "true")}
    return () => {
      for (const {element, hadInert, ariaHidden} of background) {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden"); else element.setAttribute("aria-hidden", ariaHidden);
      }
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    // Both action buttons stay disabled during a mutation. The labelled
    // dialog remains a valid focus target until those actions are available.
    if (pending) dialogRef.current?.focus(); else cancelRef.current?.focus();
  }, [open, pending]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {event.preventDefault(); if (!pending) onCancelRef.current(); return}
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const enabled = [cancelRef.current, confirmRef.current].filter((button):button is HTMLButtonElement => button !== null && !button.disabled);
      const first = enabled[0], last = enabled.at(-1), active = document.activeElement;
      if (!first || !last) {event.preventDefault(); dialog.focus(); return}
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={() => !pending && onCancel()} ref={backdropRef}>
      <section
        aria-describedby="operation-dialog-description"
        aria-labelledby="operation-dialog-title"
        aria-modal="true"
        aria-busy={pending}
        className="confirm-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className={`dialog-icon ${danger ? "danger" : ""}`} aria-hidden="true">
          {danger ? "!" : "✓"}
        </div>
        <div>
          <p className="eyebrow">CONFIRMACIÓN REQUERIDA</p>
          <h2 id="operation-dialog-title">{title}</h2>
        </div>
        <p id="operation-dialog-description">{consequence}</p>
        {error ? <p className="state-card error-state" role="alert">{error}</p> : null}
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
    </div>, document.body
  );
}
