import { useEffect, useRef } from "react";

export function BusinessConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  pendingLabel = "Saving…",
  pending = false,
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancelRef.current();
      if (event.key !== "Tab") return;
      const first = cancelRef.current, last = confirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

  if (!open) return null;
  return <div className="media-dialog-backdrop" onMouseDown={() => { if (!pending) onCancel(); }}>
    <section className="media-dialog ads-confirm-dialog" role="dialog" aria-modal="true" aria-busy={pending} aria-labelledby="ads-confirm-title" aria-describedby="ads-confirm-description" onMouseDown={(event) => event.stopPropagation()}>
      <h3 id="ads-confirm-title">{title}</h3>
      <p id="ads-confirm-description">{description}</p>
      <div className="compact-actions">
        <button className="secondary-button" type="button" disabled={pending} onClick={onCancel} ref={cancelRef}>{cancelLabel}</button>
        <button className={danger ? "danger-button" : "primary-button"} type="button" aria-busy={pending} disabled={pending} onClick={onConfirm} ref={confirmRef}>{pending ? pendingLabel : confirmLabel}</button>
      </div>
    </section>
  </div>;
}
